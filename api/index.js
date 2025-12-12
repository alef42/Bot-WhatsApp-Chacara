require('dotenv').config();
const express = require('express');
const cors = require('cors');
// const mongoose = require('mongoose'); // REMOVIDO: Não precisamos mais do Mongo!
const { Client, LocalAuth } = require('whatsapp-web.js'); // USANDO LOCAL AUTH
// const { MongoStore } = require('wwebjs-mongo'); // REMOVIDO
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- CONFIGURAÇÃO E SERVIÇOS ---

// Configurações do Bot
let botConfig = {
    testMode: false,
    allowedNumbers: [],
    blockedNumbers: [],
    systemPrompt: `Você é a IA da 'Chácara da Paz', um refúgio incrível para eventos e lazer! 🌿🏊‍♂️
    
    📋 *SUAS DIRETRIZES:*
    1. **Personalidade:** Seja super educada, animada (use emojis 🌞🍃) e prestativa.
    2. **Objetivo:** Tirar dúvidas sobre a chácara, estrutura e localização.
    3. **Preços/Reservas:** Se perguntarem de valores ou datas, sutilmente direcione para o site ou peça para consultar o menu.
    4. **Limitações:** Você NÃO fecha negócio, apenas tira dúvidas.
    
    🚨 *REGRA DE OURO:*
    Se o cliente parecer irritado, quiser falar com dono/gerente ou pedir algo complexo, responda com sua resposta normal e adicione a tag: [CHAMAR_ATENDENTE].
    
    ℹ️ *INFORMAÇÕES DA CHÁCARA:*
    - **Lazer:** Piscina aquecida, campo de futebol, parquinho, salão de jogos (sinuca/pebolim), churrasqueira.
    - **Local:** Bairro tranquilo, fácil acesso (envie o mapa se pedirem).
    - **Ideal para:** Aniversários, casamentos, retiros e fins de semana em família.
    
    Comece sempre com uma saudação calorosa!`
};

// Carregar Prompt e Configs do Disco na Inicialização
try {
    const fs = require('fs-extra');
    if (fs.existsSync('ai_prompt.json')) {
        const p = fs.readJsonSync('ai_prompt.json');
        if(p.prompt) botConfig.systemPrompt = p.prompt;
    }
    if (fs.existsSync('bot_config.json')) {
        const c = fs.readJsonSync('bot_config.json');
        botConfig.testMode = c.testMode;
        botConfig.allowedNumbers = c.allowedNumbers || [];
        botConfig.blockedNumbers = c.blockedNumbers || [];
    }
} catch(e) { console.log('Configs iniciais padrão.'); }

// Simulando serviços externos que existiam no código original
const configService = { 
    getGeneralConfig: async () => botConfig, 
    updateGeneralConfig: async (cfg) => { botConfig = cfg } 
};

// Variáveis de Estado
let isConnected = false;
let currentQrCode = null;

// Estados de Conversa
let conversationState = {};
let botActivePerUser = {};
let attendantActive = {}; 
let inactivityTimers = {}; 
let attendantInactivityTimers = {};

// --- INICIALIZAÇÃO DO SERVIDOR ---
async function startServer() {
    try {
        console.log('🔄 Inicializando Bot (LocalAuth)...');
        // MongoDB REMOVIDO COMPLETAMENTE
        
        console.log('🚀 Iniciando Cliente WhatsApp (Puppeteer)...');
        
        const client = new Client({
            authStrategy: new LocalAuth(), // Salva a sessão na pasta .wwebjs_auth
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-component-extensions-with-background-pages',
                    '--disable-default-apps',
                    '--mute-audio',
                    '--no-default-browser-check',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-sync',
                    '--blink-settings=imagesEnabled=false', // Desativa Imagens (Economia RAM)
                    '--disable-remote-fonts', // Desativa Fontes
                ]
            }
        });

        // --- EVENTOS DO CLIENTE ---

        client.on('qr', (qr) => {
            currentQrCode = qr;
            isConnected = false;
            console.log('📸 QR Code Gerado! Scanear agora:');
            qrcode.generate(qr, { small: true });
        });

        client.on('ready', () => {
            console.log('✅ WhatsApp (Puppeteer) Conectado e Pronto!');
            isConnected = true;
            currentQrCode = null;
        });

        client.on('authenticated', () => {
            console.log('🔐 Cliente Autenticado');
        });

        client.on('auth_failure', msg => {
            console.error('❌ Falha na Autenticação:', msg);
        });

        client.on('remote_session_saved', () => {
            console.log('💾 Sessão salva no MongoDB (RemoteAuth)');
        });

        client.on('disconnected', (reason) => {
            console.log('❌ Cliente desconectado:', reason);
            isConnected = false;
        });

        // --- MANIPULAÇÃO DE MENSAGENS ---
        client.on('message', async msg => {
            // Ignora status@broadcast e outros tipos de status
            if (msg.from === 'status@broadcast' || msg.from.includes('status') || msg.type === 'status') return;

            const chatId = msg.from;
            const body = msg.body;
            const senderName = msg._data.notifyName || chatId.split('@')[0];
            const isGroup = chatId.includes('@g.us');

            console.log(`📩 De: ${senderName} (${chatId}): ${body}`);

            await processMessage(client, chatId, body, senderName, isGroup);
        });

        await client.initialize();

        // --- API EXPRESS DE SUPORTE ---
        const app = express();
        const port = process.env.PORT || 4000;

        app.use(cors());
        app.use(express.json());
        
        // Rota Raiz para Health Check do Render
        app.get('/', (req, res) => {
            res.send('🤖 Bot WhatsApp Chácara da Paz está Online!');
        });

        app.get('/api/status', (req, res) => {
            res.json({
                connected: isConnected,
                qr_code: currentQrCode ? true : false,
                engine: 'Whatsapp-Web.js (Puppeteer)'
            });
        });

        // --- ROTAS DE MONITORAMENTO ---
        const MONITOR_FILE = 'monitor_config.json';
        const fs = require('fs-extra');

        // Carregar Config ou Criar Padrão
        let monitorConfig = { enabled: false, recipients: [], checkTime: '09:00' };
        try {
            if (fs.existsSync(MONITOR_FILE)) {
                monitorConfig = fs.readJsonSync(MONITOR_FILE);
            } else {
                console.log('⚠️ Config de monitoramento não encontrada. Criando padrão...');
                // Adiciona o número bloqueado por padrão se não existir
                if (!monitorConfig.blockedNumbers) monitorConfig.blockedNumbers = [];
                // monitorConfig.blockedNumbers.push('5511999999999@c.us'); // Exemplo
                fs.writeJsonSync(MONITOR_FILE, monitorConfig);
            }
        } catch (e) { console.error('Erro ler monitor config:', e); }

        app.get('/api/monitor-config', (req, res) => res.json(monitorConfig));
        
        app.post('/api/monitor-config', (req, res) => {
            monitorConfig = req.body;
            fs.writeJsonSync(MONITOR_FILE, monitorConfig);
            res.json({ success: true });
            console.log('🔔 Configuração de Monitoramento Atualizada:', monitorConfig);
        });

        app.post('/api/monitor-run', async (req, res) => {
            console.log('🔔 [API] Recebido comando de execução manual.');
            const r = await runMonitor(client, true); // TRUE = Teste com Leila
            res.json(r || { success: true });
        });

        // --- ROTA: CONFIG DO BOT (Acesso) ---
        const BOT_CONFIG_FILE = 'bot_config.json';
        if (!fs.existsSync(BOT_CONFIG_FILE)) {
             fs.writeJsonSync(BOT_CONFIG_FILE, { testMode: false, allowedNumbers: [], blockedNumbers: [] });
        }
        
        app.get('/api/bot-config', (req, res) => {
            try { res.json(fs.readJsonSync(BOT_CONFIG_FILE)); } 
            catch { res.json({}); }
        });

        app.post('/api/bot-config', (req, res) => {
            const newConfig = req.body;
            fs.writeJsonSync(BOT_CONFIG_FILE, newConfig);
            // Atualiza memória
            botConfig.testMode = newConfig.testMode;
            botConfig.allowedNumbers = newConfig.allowedNumbers || [];
            botConfig.blockedNumbers = newConfig.blockedNumbers || [];
            res.json({ success: true });
        });

        // --- ROTA: PROMPT IA ---
        const PROMPT_FILE = 'ai_prompt.json';
        if (!fs.existsSync(PROMPT_FILE)) fs.writeJsonSync(PROMPT_FILE, { prompt: botConfig.systemPrompt });

        app.get('/api/prompt', (req, res) => {
            try { res.json(fs.readJsonSync(PROMPT_FILE)); } 
            catch { res.json({ prompt: '' }); }
        });

        app.post('/api/prompt', (req, res) => {
            const { prompt } = req.body;
            fs.writeJsonSync(PROMPT_FILE, { prompt });
            botConfig.systemPrompt = prompt;
            res.json({ success: true });
        });

        // --- ROTA: AGENDAMENTOS ---
        const SCHEDULES_FILE = 'schedules.json';
        if (!fs.existsSync(SCHEDULES_FILE)) fs.writeJsonSync(SCHEDULES_FILE, []);

        app.get('/api/schedules', (req, res) => {
            try { res.json(fs.readJsonSync(SCHEDULES_FILE)); } 
            catch { res.json([]); }
        });

        app.post('/api/schedules', (req, res) => {
            const list = fs.readJsonSync(SCHEDULES_FILE);
            const newItem = { id: Date.now().toString(), ...req.body };
            list.push(newItem);
            fs.writeJsonSync(SCHEDULES_FILE, list);
            res.json(newItem);
        });

        app.delete('/api/schedules/:id', (req, res) => {
            const list = fs.readJsonSync(SCHEDULES_FILE);
            const newList = list.filter(i => i.id !== req.params.id);
            fs.writeJsonSync(SCHEDULES_FILE, newList);
            res.json({ success: true });
        });

        // Configura Intervalo de Monitoramento (Check a cada 1 minuto)
        setInterval(() => {
            if (!monitorConfig.enabled || !isConnected) return;
            
            const now = new Date();
            const currentHM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            
            // Se bater o horário (e ainda não tiver rodado hoje - lógica simplificada, roda se bater o minuto)
            if (currentHM === monitorConfig.checkTime) {
                // Evita flood: poderia usar um flag "lastRunDate"
                runMonitor(client);
            }
        }, 60000);    

        app.listen(port, () => {
            console.log(`✅ API Server rodando na porta ${port}`);
        });

    } catch (error) {
        console.error('❌ Erro Fatal na Inicialização:', error);
    }
}

// --- LÓGICA DE NEGÓCIO (Adaptada) ---

async function processMessage(client, chatId, body, senderName, isGroup) {
    // Ignora grupos (exceto comandos especiais se precisar)
    if (isGroup) return;

    // 🚫 Verificar Bloqueio
    if (botConfig.blockedNumbers && botConfig.blockedNumbers.includes(chatId)) {
        console.log(`🚫 Ignorando número bloqueado: ${chatId}`);
        return;
    }

    const msgRaw = body.trim();
    const msgLower = msgRaw.toLowerCase();

    // Comandos de Administração
    if (msgLower === 'ativar bot') {
        botActivePerUser[chatId] = true;
        await client.sendMessage(chatId, '🤖 Bot ativado.');
        return;
    }
    if (msgLower === 'desativar bot') {
        botActivePerUser[chatId] = false;
        await client.sendMessage(chatId, '🤖 Bot desativado.');
        return;
    }

    // Controle de Pausa/Atendente
    if (attendantActive[chatId] || botActivePerUser[chatId] === false) {
        console.log(`Bot pausado para ${chatId}`);
        if(attendantActive[chatId]) resetAttendantInactivityTimer(chatId);
        return;
    }

    resetInactivityTimer(client, chatId);

    // Fluxo de Conversa
    if (!conversationState[chatId]) {
        conversationState[chatId] = 'initial';
        await sendMainMenu(client, chatId);
    } else {
        await handleUserResponse(client, chatId, msgRaw);
    }
}

// --- HANDLERS (Igual ao original, adaptado para 'client') ---

async function handleUserResponse(client, chatId, msgRaw) {
    const state = conversationState[chatId];
    switch (state) {
        case 'initial': await handleInitialResponse(client, chatId, msgRaw); break;
        case 'info': await handleInfoResponse(client, chatId, msgRaw); break;
        case 'info_lazer': await handleInfoLazerResponse(client, chatId, msgRaw); break;
        case 'date': await handleDateResponse(client, chatId, msgRaw); break;
        default: 
            conversationState[chatId] = 'initial';
            await handleAIResponse(client, chatId, msgRaw);
    }
}

async function sendMainMenu(client, chatId) {
    const text = '🌿 *Bem-vindo à Chácara da Paz!* 🌞🍃\n\nComo posso ajudar hoje?\n\n1️⃣ *Consultar Disponibilidade de Data*\n2️⃣ *Verificar Itens de Lazer*\n3️⃣ *Falar com Atendente*\n\n_Digite o número ou o nome da opção._';
    await client.sendMessage(chatId, text);
}

async function handleInitialResponse(client, chatId, msgRaw) {
    const msg = msgRaw.toLowerCase();
    
    if (msg === '1' || msg.includes('disponibilidade') || msg.includes('reserva')) {
        conversationState[chatId] = 'date';
        await client.sendMessage(chatId, '📅 Informe a *data de entrada* desejada.\nFormato: *Dia/Mês/Ano* (Ex: 10/12/2024)');
    } 
    else if (msg === '2' || msg.includes('lazer')) {
        conversationState[chatId] = 'info';
        await client.sendMessage(chatId, '🏊‍♂️ *Lazer e Estrutura*\n\nTemos piscina, churrasqueira, campo e mais.\n\nDeseja ver a lista completa?\n1️⃣ *Sim, mostrar tudo*\n2️⃣ *Voltar*');
    } 
    else if (msg === '3' || msg.includes('atendente')) {
        await client.sendMessage(chatId, '✅ Chamando um atendente! Aguarde...');
        botActivePerUser[chatId] = false;
        attendantActive[chatId] = true;
    } 
    else {
        await handleAIResponse(client, chatId, msgRaw);
    }
}

async function handleInfoResponse(client, chatId, msgRaw) {
    const msg = msgRaw.toLowerCase();
    if (msg === '1' || msg === 'sim') {
        const lazer = '✅ *Estrutura Completa:*\n🎱 Pebolim e Sinuca\n🏓 Ping Pong\n⚽ Campo Futebol\n🏊 Piscina Aquecida\n🍖 Churrasqueiras\n... e muito mais!';
        await client.sendMessage(chatId, lazer);
        await client.sendMessage(chatId, 'Quer ver os preços?\n1️⃣ *Sim*\n2️⃣ *Voltar*');
        conversationState[chatId] = 'info_lazer';
    } else {
        conversationState[chatId] = 'initial';
        await sendMainMenu(client, chatId);
    }
}

async function handleInfoLazerResponse(client, chatId, msgRaw) {
    const msg = msgRaw.toLowerCase();
    if(msg.includes('1') || msg.includes('sim')) {
        await client.sendMessage(chatId, '💲 *Tabela de Preços e Pacotes*\n\nPara ver valores e reservar, acesse nosso site:\n👉 https://chacaradapazv2.netlify.app/\n\n_Lá você consegue simular datas e fechar sua reserva!_ 😉');
        conversationState[chatId] = 'initial';
    } else {
        conversationState[chatId] = 'initial';
        await sendMainMenu(client, chatId);
    }
}

async function handleDateResponse(client, chatId, msgRaw) {
    // Validação básica de data
    if (msgRaw.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
        await client.sendMessage(chatId, '📆 Verificando...');
        
        // Simulação de check
        await new Promise(r => setTimeout(r, 1000));
        
        // Aqui você integraria com sua lógica real de checkAvailability
        await client.sendMessage(chatId, '✅ *Data Disponível!* 🎉\nReserve em: https://chacaradapazv2.netlify.app/');
        
        conversationState[chatId] = 'initial';
    } else {
        await client.sendMessage(chatId, '⚠️ Formato inválido. Use dia/mês/ano.');
    }
}

async function handleAIResponse(client, chatId, userMessage) {
    const msg = userMessage.trim().toLowerCase();
    
    // Keywords para sair da IA
    if (['menu', 'voltar', 'inicio', 'sair'].includes(msg)) {
        conversationState[chatId] = 'initial';
        await sendMainMenu(client, chatId);
        return;
    }

    try {
        // Prompt do Sistema
        let systemPrompt = botConfig.systemPrompt || "Você é um assistente útil.";
        const fullPrompt = systemPrompt.replace('${userMessage}', userMessage) + `\nUsuario diz: ${userMessage}`;

        const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '').getGenerativeModel({ model: "gemini-pro"});
        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const text = response.text().trim();

        if (text.includes('[CHAMAR_ATENDENTE]')) {
             await client.sendMessage(chatId, 'Vou chamar um humano para te ajudar! 🏃💨');
             botActivePerUser[chatId] = false;
             attendantActive[chatId] = true;
             return;
        }

        await client.sendMessage(chatId, text);

    } catch (e) {
        console.error('Erro IA:', e);
        await client.sendMessage(chatId, 'Estou meio confuso agora... aqui está o menu para ajudar:');
        await sendMainMenu(client, chatId);
    }
}

// --- FIREBASE ADMIN SETUP ---
const MONITOR_STATE_FILE = 'monitor_state.json'; // Arquivo para guardar IDs de mensagens fixadas
const admin = require('firebase-admin');
const serviceAccount = require('./site-chacara-da-paz-6d1bd-firebase-adminsdk-fbsvc-8dade94cb7.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

// --- MONITORAMENTO AUTOMÁTICO ---
async function runMonitor(client, isTest = false) {
    console.log(`🔎 [MONITOR] Iniciando verificação... (Modo Teste: ${isTest})`);
    
    // Carregar Estado (Mensagens Fixadas Anteriormente)
    const fs = require('fs-extra');
    let monitorState = {};
    try { 
        if (fs.existsSync(MONITOR_STATE_FILE)) {
             monitorState = fs.readJsonSync(MONITOR_STATE_FILE);
        }
    } catch(e) { console.error('Erro ler estado monitor:', e); }

    let novasReservas = [];

    if (isTest) {
        // MODO TESTE: Dados Fictícios
        novasReservas = [{ 
            cliente: 'Leila (Teste)', 
            telefone: '5511997102246', 
            data: '13/12/2025', 
            status: 'Confirmada' 
        }];
    } else {
        // MODO REAL: Busca no FIREBASE
        try {
            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);
            
            // Formata YYYY-MM-DD para comparar com o campo 'start' do Firebase
            const y = tomorrow.getFullYear();
            const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
            const d = String(tomorrow.getDate()).padStart(2, '0');
            const tomorrowStr = `${y}-${m}-${d}`;

            console.log(`🔎 [MONITOR] Buscando reservas para: ${tomorrowStr}`);

            // Busca na coleção 'reservations' onde start == tomorrowStr e status == 'reservado'
            const snapshot = await db.collection('reservations')
                .where('start', '==', tomorrowStr)
                .where('status', '==', 'reservado')
                .get();

            if (!snapshot.empty) {
                snapshot.forEach(doc => {
                    const data = doc.data();
                    novasReservas.push({
                         cliente: data.name || 'Cliente',
                         telefone: data.whatsapp || data.phone || 'Sem telefone',
                         dataEntrada: data.start.split('-').reverse().join('/'), 
                         dataSaida: data.end ? data.end.split('-').reverse().join('/') : 'A definir',
                         status: 'Confirmado'
                    });
                });
            }
            
            console.log(`🔎 [MONITOR] Encontradas ${novasReservas.length} reservas reais para amanhã.`);

        } catch (error) {
            console.error('❌ Erro ao buscar no Firebase:', error);
            return { error: 'Falha no Firebase' };
        }
    }

    if (novasReservas.length > 0) {
        const fs = require('fs-extra');
        let config = { recipients: [] };
        try { config = fs.readJsonSync('monitor_config.json'); } catch(e) {}

        if (!config.recipients || config.recipients.length === 0) {
            console.warn('⚠️ [MONITOR] Sem destinatários configurados! Adicione alguém na lista.');
            return { error: 'Sem destinatários' };
        }

        console.log(`📤 [MONITOR] Enviando alerta para ${config.recipients.length} destinos...`);

        for (const reserva of novasReservas) {
            // Formatação Bonita
            const msg = `📅 *Próxima Reserva Chegando!*\n\n` +
                        `👤 ${reserva.cliente}\n` +
                        `📞 ${reserva.telefone || 'Sem telefone'}\n` +
                        `------------------------------\n` +
                        `📥 *Check-in:* ${reserva.dataEntrada || reserva.data} às 12:00\n` +
                        `📤 *Check-out:* ${reserva.dataSaida} às 18:00`;

            for (const recipient of config.recipients) {
                try {
                    let chatId = recipient.includes('@') ? recipient : `${recipient}@c.us`; 
                    
                    // 1. Tenta DESFIXAR a anterior (se houver)
                    if (monitorState[chatId]) {
                        try {
                            const oldMsg = await client.getMessageById(monitorState[chatId]);
                            if (oldMsg) {
                                await oldMsg.unpin();
                                console.log(`🔓 [MONITOR] Mensagem antiga desfixada para ${chatId}`);
                            }
                        } catch (e) { console.warn('⚠️ Falha ao desfixar antiga:', e.message); }
                    }

                    const sentMsg = await client.sendMessage(chatId, msg);
                    
                    // 2. Tenta FIXAR (Pin) a nova (30 dias)
                    try {
                        await sentMsg.pin(2592000); 
                        console.log(`📌 [MONITOR] Nova mensagem fixada para ${chatId}`);
                        
                        // Atualiza Estado
                        monitorState[chatId] = sentMsg.id._serialized;
                        fs.writeJsonSync(MONITOR_STATE_FILE, monitorState);

                    } catch (pinError) {
                        console.warn(`⚠️ [MONITOR] Falha ao fixar:`, pinError.message);
                    }

                    console.log(`✅ [MONITOR] Enviado para ${chatId}`);
                } catch (e) {
                    console.error(`❌ [MONITOR] Erro ao enviar para ${recipient}:`, e.message);
                }
            }
        }
        return { success: true, count: config.recipients.length };
    } else {
        // --- NENHUMA NOVA RESERVA PARA AMANHÃ ---
        // Mas vamos verificar se o FIM DE SEMANA está livre (Business Intelligence 📈)
        const fs = require('fs-extra');
        let config = { recipients: [] };
        try { config = fs.readJsonSync('monitor_config.json'); } catch(e) {}

        if (config.recipients && config.recipients.length > 0) {
            // Lógica: Verifica próxima Sexta, Sábado e Domingo
            const today = new Date();
            const nextFriday = new Date(today);
            nextFriday.setDate(today.getDate() + (5 - today.getDay() + 7) % 7); // Próxima Sexta
            if (today.getDay() === 5) nextFriday.setDate(today.getDate()); // Se hoje é sexta

            const nextSunday = new Date(nextFriday);
            nextSunday.setDate(nextFriday.getDate() + 2);

            // Ajusta horas
            nextFriday.setHours(0,0,0,0);
            nextSunday.setHours(23,59,59,999);

            // Busca no Firebase (Lógica de Fim de Semana)
            let weekendStatus = 'LIVRE';
            try {
                // Formata datas para YYYY-MM-DD
                const toYMD = (date) => {
                    const y = date.getFullYear();
                    const m = String(date.getMonth() + 1).padStart(2, '0');
                    const d = String(date.getDate()).padStart(2, '0');
                    return `${y}-${m}-${d}`;
                }
                
                const fridayStr = toYMD(nextFriday);
                const saturdayStr = toYMD(new Date(nextFriday.getTime() + 86400000));
                const sundayStr = toYMD(nextSunday);

                // Query simples: verifica se existe ALGUMA reserva confirmada ou bloqueada nessas datas
                const snapshot = await db.collection('reservations')
                    .where('start', 'in', [fridayStr, saturdayStr, sundayStr])
                    .where('status', 'in', ['reservado', 'bloqueado'])
                    .get();

                if (!snapshot.empty) weekendStatus = 'OCUPADO';

            } catch(e) { console.error('Erro checando fim de semana:', e); }

            let msg = '';
            
            if (weekendStatus === 'LIVRE') {
                 msg = `⚠️ *Atenção: Fim de Semana Livre!* 😱\n\n` +
                       `Não encontrei reservas para a próxima Sexta, Sábado ou Domingo (${nextFriday.toLocaleDateString('pt-BR')} a ${nextSunday.toLocaleDateString('pt-BR')}).\n` +
                       `💡 *Sugestão:* Que tal lançar uma promoção nos grupos?`;
            } else {
                 msg = `✅ *Tudo Tranquilo!*\n\n` + 
                       `Sem novas reservas para amanhã, mas o fim de semana já tem ocupação (ou bloqueio). 🏖️`;
            }

             for (const recipient of config.recipients) {
                try {
                    let chatId = recipient.includes('@') ? recipient : `${recipient}@c.us`; 

                    // 1. Tenta DESFIXAR a anterior
                    if (monitorState[chatId]) {
                        try {
                            const oldMsg = await client.getMessageById(monitorState[chatId]);
                            if (oldMsg) await oldMsg.unpin();
                        } catch (e) {}
                    }

                    const sentMsg = await client.sendMessage(chatId, msg);
                    
                    // 2. Tenta FIXAR a nova
                    try {
                        await sentMsg.pin(2592000);
                        monitorState[chatId] = sentMsg.id._serialized;
                        fs.writeJsonSync(MONITOR_STATE_FILE, monitorState);
                    } catch (e) {}

                } catch (e) {}
            }
        }
        console.log('💤 [MONITOR] Relatório de ociosidade enviado.');
        return { success: true, count: 0 };
    }
}

// --- TIMERS ---
function resetAttendantInactivityTimer(chatId) {
    if (attendantInactivityTimers[chatId]) clearTimeout(attendantInactivityTimers[chatId]);
    attendantInactivityTimers[chatId] = setTimeout(() => {
        attendantActive[chatId] = false;
        conversationState[chatId] = 'initial';
        console.log(`🤖 Bot reativado para ${chatId} (timeout atendente).`);
    }, 20 * 60 * 1000);
}

function resetInactivityTimer(client, chatId) {
    if (inactivityTimers[chatId]) clearTimeout(inactivityTimers[chatId]);
    inactivityTimers[chatId] = setTimeout(async () => {
        await client.sendMessage(chatId, 'Você ainda está aí? O atendimento foi encerrado por inatividade.');
        await sendMainMenu(client, chatId);
        conversationState[chatId] = 'initial';
    }, 5 * 60 * 1000);
}

// START
startServer();
