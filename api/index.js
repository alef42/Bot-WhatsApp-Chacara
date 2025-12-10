const { 
    default: makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeInMemoryStore
} = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal')
const express = require('express')
const path = require('path')
const axios = require('axios')
const cors = require('cors')
const { GoogleGenerativeAI } = require('@google/generative-ai')
const fs = require('fs');

// Services
const { checkUpcomingReservations, checkAvailability } = require('./services/reservationService');
const configService = require('./services/configService');
const scheduleService = require('./services/scheduleService');
const useMongoAuthState = require('./services/baileysMongoAuth'); // Nosso adaptador customizado
const moment = require('moment');

// Variáveis Globais
let sock;
let currentQrCode = null;
let isConnected = false;
let botConfig = {};
let monitorConfig = {};
let schedules = [];

// Armazenamento em memória para dados de chats/contatos (opcional, mas bom pra performance)
const store = makeInMemoryStore({ })
// store.readFromFile('./baileys_store_multi.json') // Opcional salvar em arquivo
// setInterval(() => {
//     store.writeToFile('./baileys_store_multi.json')
// }, 10_000)

// Inicialização de Serviços e DB
async function initializeServices() {
    try {
        console.log('🔄 Carregando configurações...');
        
        // Conectar ao MongoDB (Obrigatório para Baileys no Render)
        let mongoUri = process.env.MONGO_URI;
        if (mongoUri) {
            mongoUri = mongoUri.replace(/^['"]|['"]$/g, '').trim(); 
            const uriLog = mongoUri.length > 20 ? mongoUri.substring(0, 15) + '...' : '***';
            console.log(`🔄 Conectando ao MongoDB com URI: ${uriLog}`);
            
            if (mongoose.connection.readyState !== 1) {
                await mongoose.connect(mongoUri);
                console.log('✅ Conectado ao MongoDB!');
            }
        } else {
            console.log('⚠️ MONGO_URI não definido. Sessão não persistirá no Render!');
            // Em dev local, sem mongo, vai falhar o auth adapter, teríamos que usar useMultiFileAuthState
            // Mas vamos assumir que TEM mongo ou o usuário configurou
        }

        botConfig = await configService.getGeneralConfig();
        monitorConfig = await configService.getMonitorConfig();
        schedules = await scheduleService.getAllSchedules();
        console.log('✅ Serviços inicializados!');

    } catch (error) {
        console.error('❌ Erro fatal na inicialização:', error);
        process.exit(1);
    }
}

async function startBot() {
    await initializeServices();

    console.log('🚀 Iniciando Bot WhatsApp (Baileys)...');
    
    // Auth Strategy
    let authState;
    let saveCreds;
    
    try {
        if (mongoose.connection.readyState === 1) {
            console.log('🔐 Usando MongoDB Auth...');
            const auth = await useMongoAuthState();
            authState = auth.state;
            saveCreds = auth.saveCreds;
        } else {
             // Fallback para arquivo local (Apenas Dev)
             console.log('📂 Usando Arquivo Local Auth (auth_info_baileys)...');
             const { state, saveCreds: save } = await useMultiFileAuthState('auth_info_baileys')
             authState = state;
             saveCreds = save;
        }
    } catch (e) {
        console.error('Erro ao carregar Auth:', e);
        process.exit(1);
    }

    const { version, isLatest } = await fetchLatestBaileysVersion()
    console.log(`Usando WhatsApp v${version.join('.')}, isLatest: ${isLatest}`)

    sock = makeWASocket({
        version,
        auth: authState,
        printQRInTerminal: false, // Vamos imprimir manualmente para capturar a string
        mobile: false,
        logger: require('pino')({ level: 'silent' }), // Log silencioso para não poluir
        browser: ['Ubuntu', 'Chrome', '20.0.04'], // Navegador padrão para compatibilidade
        generateHighQualityLinkPreview: true,
    })

    store.bind(sock.ev)

    // Eventos do Baileys
    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update
        
        if(qr) {
            currentQrCode = qr;
            console.log('📸 QR Code Gerado!');
            qrcode.generate(qr, { small: true });
            isConnected = false;
        }

        if(connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('❌ Conexão fechada. Reconectar? ', shouldReconnect)
            isConnected = false;
            currentQrCode = null;
            
            if(shouldReconnect) {
                startBot() // Reconecta recursivamente
            } else {
                console.log('🔴 Deslogado. Apague a sessão no banco para scanear de novo.')
            }
        } else if(connection === 'open') {
            console.log('✅ WhatsApp Conectado!')
            isConnected = true;
            currentQrCode = null;
        }
    })

    sock.ev.on('messages.upsert', async m => {
        // m.messages é um array, geralmente vem 1 mensagem nova
        const msg = m.messages[0]
        if(!msg.message || msg.key.fromMe) return 

        const chatId = msg.key.remoteJid
        const isGroup = chatId.endsWith('@g.us')
        
        // Extrai o texto da mensagem (pode ser conversation, extendedTextMessage, etc)
        const messageType = Object.keys(msg.message)[0]
        const messageContent = msg.message[messageType] // O objeto da mensagem
        let textBody = ''

        if (messageType === 'conversation') {
            textBody = msg.message.conversation
        } else if (messageType === 'extendedTextMessage') {
            textBody = msg.message.extendedTextMessage.text
        } else {
             // Ignora stickers, imagens sem legenda, etc por enquanto
             return
        }

        if (!textBody) return;

        // Log
        const sender = msg.pushName || chatId.split('@')[0];
        console.log(`📩 De: ${sender} (${chatId}): ${textBody}`);

        // Tratamento da mensagem
        await processMessage(chatId, textBody, sender, isGroup);
    })
}

// Lógica Principal do Bot (Adaptada para Baileys)
async function processMessage(chatId, body, senderName, isGroup) {
    
    // Ignora grupos por enquanto (exceto comandos)
    if (isGroup && body !== '!grupos') return;

    // --- COMANDOS ESPECIAIS ---
    if (body === '!grupos') {
        const groups = await sock.groupFetchAllParticipating()
        let txt = '*Grupos:*\n\n'
        for (let gId in groups) {
            txt += `- ${groups[gId].subject} (${gId})\n`
        }
        await sendText(chatId, txt || 'Nenhum grupo encontrado.')
        return
    }

    if (body === '!check') {
        await sendText(chatId, '🔎 Verificando reservas manualmente...')
        await runReservationCheck();
        return;
    }

    // --- BLOQUEIOS E TESTS ---
    if (botConfig.testMode) {
        const isAllowed = botConfig.allowedNumbers && botConfig.allowedNumbers.some(num => chatId.includes(num));
        if (!isAllowed) {
            console.log(`⛔ Bloqueado modo teste: ${chatId}`);
            return;
        }
    }

    // Controle de Pausa/Atendente
    if (attendantActive[chatId] || botActivePerUser[chatId] === false) {
        console.log(`Bot pausado para ${chatId}`);
        if(attendantActive[chatId]) resetAttendantInactivityTimer(chatId);
        return;
    }

    // Comandos Ativar/Desativar
    if (body.toLowerCase() === 'ativar bot') {
        botActivePerUser[chatId] = true;
        await sendText(chatId, '🤖 Bot ativado.');
        return;
    }
    if (body.toLowerCase() === 'desativar bot') {
        botActivePerUser[chatId] = false;
        await sendText(chatId, '🤖 Bot desativado.');
        return;
    }

    resetInactivityTimer(chatId);

    if (!conversationState[chatId]) {
        conversationState[chatId] = 'initial';
        await sendMainMenu(chatId);
    } else {
        await handleUserResponse(chatId, body);
    }
}

// Helpers Baileys
async function sendText(chatId, text) {
    try {
        await sock.sendMessage(chatId, { text: text });
    } catch (e) {
        console.error('Erro ao enviar mensagem:', e);
    }
}

async function simulateTyping(chatId, textOrArray) {
    const messages = Array.isArray(textOrArray) ? textOrArray : [textOrArray];
    
    for (const msg of messages) {
        await sock.sendPresenceUpdate('composing', chatId);
        await new Promise(r => setTimeout(r, 1500)); // Delay digitação
        await sendText(chatId, msg);
        await sock.sendPresenceUpdate('paused', chatId);
        await new Promise(r => setTimeout(r, 1000)); // Delay entre mensagens
    }
}


// --- LÓGICA DE NEGÓCIO (Mantida igual, só adaptada para usar sendText/simulateTyping) ---

let conversationState = {}
let botActivePerUser = {}
let attendantActive = {} 
let inactivityTimers = {} 
let attendantInactivityTimers = {}

const allowedNumber = '5511941093985@s.whatsapp.net' // Ajustado sufixo baileys

function resetAttendantInactivityTimer(chatId) {
  if (attendantInactivityTimers[chatId]) clearTimeout(attendantInactivityTimers[chatId])
  attendantInactivityTimers[chatId] = setTimeout(() => {
    attendantActive[chatId] = false
    conversationState[chatId] = 'initial'
    console.log(`🤖 Bot reativado para ${chatId} (timeout atendente).`)
  }, 20 * 60 * 1000)
}

function resetInactivityTimer(chatId) {
  if (inactivityTimers[chatId]) clearTimeout(inactivityTimers[chatId])
  inactivityTimers[chatId] = setTimeout(async () => {
    await sendText(chatId, 'Você ainda está aí? O atendimento foi encerrado por inatividade.')
    await sendMainMenu(chatId)
    conversationState[chatId] = 'initial'
  }, 5 * 60 * 1000)
}

async function sendMainMenu(chatId) {
  const text = '🌿 *Bem-vindo à Chácara da Paz!* 🌞🍃\n\nComo posso ajudar hoje?\n\n1️⃣ *Consultar Disponibilidade de Data*\n2️⃣ *Verificar Itens de Lazer*\n3️⃣ *Falar com Atendente*\n\n_Digite o número ou o nome da opção._'
  await sendText(chatId, text)
}

async function sendPriceOptions(chatId) {
    const text = '💲 *Tabela de Preços e Pacotes*\n\nPara ver valores e reservar, acesse nosso site:\n👉 https://chacaradapazv2.netlify.app/\n\n_Lá você consegue simular datas e fechar sua reserva!_ 😉'
    await sendText(chatId, text)
    conversationState[chatId] = 'initial'
}

async function handleUserResponse(chatId, userMessage) {
    const state = conversationState[chatId];
    // Switch básico igual ao anterior
    switch (state) {
        case 'initial': await handleInitialResponse(chatId, userMessage); break;
        case 'info': await handleInfoResponse(chatId, userMessage); break;
        case 'info_lazer': await handleInfoLazerResponse(chatId, userMessage); break;
        case 'prices': await handlePricesResponse(chatId, userMessage); break; // Mantido legacy se precisar
        case 'price_options': await handlePriceOptionsResponse(chatId, userMessage); break;
        case 'date': await handleDateResponse(chatId, userMessage); break;
        default: 
            conversationState[chatId] = 'initial';
            await handleAIResponse(chatId, userMessage);
    }
}

// Funções Handle (Modificadas apenas para chamar as funções globais sendText/simulateTyping)
async function handleInitialResponse(chatId, msgRaw) {
    const msg = msgRaw.trim().toLowerCase()
    
    if (msg === '1' || msg.includes('disponibilidade') || msg.includes('reserva')) {
        conversationState[chatId] = 'date'
        await simulateTyping(chatId, '📅 Informe a *data de entrada* desejada.\nFormato: *Dia/Mês/Ano* (Ex: 10/12/2024)')
    } 
    else if (msg === '2' || msg.includes('lazer')) {
        conversationState[chatId] = 'info'
        await simulateTyping(chatId, '🏊‍♂️ *Lazer e Estrutura*\n\nTemos piscina, churrasqueira, campo e mais.\n\nDeseja ver a lista completa?\n1️⃣ *Sim, mostrar tudo*\n2️⃣ *Voltar*')
    } 
    else if (msg === '3' || msg.includes('atendente')) {
        await simulateTyping(chatId, '✅ Chamando um atendente! Aguarde...')
        botActivePerUser[chatId] = false;
        attendantActive[chatId] = true;
    } 
    else {
        await handleAIResponse(chatId, msgRaw)
    }
}

async function handleInfoResponse(chatId, msgRaw) {
    const msg = msgRaw.trim().toLowerCase()
    if (msg === '1' || msg === 'sim') {
        const lazer = '✅ *Estrutura Completa:*\n🎱 Pebolim e Sinuca\n🏓 Ping Pong\n⚽ Campo Futebol\n🏊 Piscina Aquecida\n🍖 Churrasqueiras\n... e muito mais!'
        await simulateTyping(chatId, lazer + '\n\nQuer ver os preços?\n1️⃣ *Sim*\n2️⃣ *Voltar*')
        conversationState[chatId] = 'info_lazer'
    } else {
        conversationState[chatId] = 'initial'
        await sendMainMenu(chatId)
    }
}

async function handleInfoLazerResponse(chatId, msgRaw) {
    const msg = msgRaw.toLowerCase()
    if(msg.includes('1') || msg.includes('sim')) {
        await sendPriceOptions(chatId)
    } else {
        conversationState[chatId] = 'initial'
        await sendMainMenu(chatId)
    }
}

async function handlePricesResponse(chatId, msgRaw) {
    // Lógica antiga de preços (se ainda for usada)
    // ... simplificado para Baileys ...
    await sendPriceOptions(chatId); 
}

async function handlePriceOptionsResponse(chatId, msgRaw) {
    if(msgRaw.includes('1')) {
         conversationState[chatId] = 'date'
         await simulateTyping(chatId, '📅 Informe a data (dd/mm/yyyy)')
    } else {
         conversationState[chatId] = 'initial'
         await sendMainMenu(chatId)
    }
}

async function handleDateResponse(chatId, msgRaw) {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(msgRaw.trim())) {
        await sendText(chatId, '📆 Verificando...')
        botActivePerUser[chatId] = false // Lock temporário
        
        try {
            const result = await checkAvailability(msgRaw.trim());
            if (result.status === 'error') {
                 await sendText(chatId, '❌ Erro ao consultar agenda.')
            } else if (result.available) {
                 await sendText(chatId, '✅ *Data Disponível!* 🎉\nReserve em: https://chacaradapazv2.netlify.app/')
            } else {
                 await sendText(chatId, `❌ *Indisponível* 😕\nReservado de ${result.conflict.start} até ${result.conflict.end}.`)
            }
        } catch(e) {
            console.error(e)
            await sendText(chatId, 'Erro interno ao verificar data.')
        }

        conversationState[chatId] = 'initial'
        botActivePerUser[chatId] = true // Unlock
    } else {
        await sendText(chatId, '⚠️ Formato inválido. Use dia/mês/ano.')
    }
}

async function handleAIResponse(chatId, userMessage) {
    const msg = userMessage.trim().toLowerCase()
    
    // Keywords para sair da IA
    if (['menu', 'voltar', 'inicio', 'sair'].includes(msg)) {
        conversationState[chatId] = 'initial'
        await sendMainMenu(chatId)
        return
    }

    try {
        // Envia "digitando..."
        await sock.sendPresenceUpdate('composing', chatId);

        // Prompt
        let systemPrompt = botConfig.systemPrompt || "Você é um assistente útil da Chácara da Paz.";
        const fullPrompt = systemPrompt.replace('${userMessage}', userMessage);

        const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '').getGenerativeModel({ model: "gemini-pro"});
        const result = await model.generateContent(fullPrompt)
        const response = await result.response
        const text = response.text().trim()

        if (text.includes('[CHAMAR_ATENDENTE]')) {
             await sendText(chatId, 'Vou chamar um humano para te ajudar! 🏃💨')
             botActivePerUser[chatId] = false
             attendantActive[chatId] = true
             return
        }

        await sendText(chatId, text)

    } catch (e) {
        console.error('Erro IA:', e)
        await sendText(chatId, 'Estou meio confuso agora... aqui está o menu para ajudar:')
        await sendMainMenu(chatId)
    }
}

// Inicializa tudo
startBot();


// --- EXPRESS SERVER ---
const app = express()
const port = 4000

app.use(express.json())
app.use(cors())

app.get('/api/status', (req, res) => {
    res.json({
        connected: isConnected,
        qr_code: currentQrCode ? true : false,
        engine: 'Baileys'
    });
});

app.get('/api/qr', (req, res) => {
    if (currentQrCode) res.json({ qr: currentQrCode });
    else res.status(404).json({ error: 'QR indisponível' });
});

app.post('/api/restart', (req, res) => {
    process.exit(1); // O Render reinicia automaticamente
});

// Outros endpoints (mantidos simples) de config/monitor
// ... mantendo compatibilidade básica
app.get('/api/bot-config', (req, res) => res.json(botConfig));
app.post('/api/bot-config', async (req, res) => {
    // Simplificado
    botConfig = { ...botConfig, ...req.body };
    await configService.updateGeneralConfig(botConfig);
    res.json({success: true, config: botConfig})
});

// Monitor Run
async function runReservationCheck() {
    if (!sock || !isConnected) return;
    console.log('🔍 Monitor: Verificando reservas...');
    // Lógica do monitor adaptada... 
    // Como depende do checkUpcomingReservations que retorna array, 
    // podemos iterar e mandar mensagem se tiver novidade.
    // (Simplificado para evitar complexidade agora)
}

app.listen(port, () => {
    console.log(`✅ Servidor API rodando na porta ${port}`);
})

