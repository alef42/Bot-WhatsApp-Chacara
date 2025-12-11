require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { Client, RemoteAuth, LocalAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const qrcode = require('qrcode-terminal');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const moment = require('moment');

// --- CONFIGURAÇÃO E SERVIÇOS ---

// Configurações do Bot
let botConfig = {
    testMode: false,
    allowedNumbers: [], // Lista de números permitidos no modo teste
    systemPrompt: `Você é o assistente virtual da 'Chácara da Paz'.
    Seu tom deve ser amigável, acolhedor e profissional.
    Responda dúvidas sobre reservas, localição e itens de lazer.
    SEMPRE que o usuário quiser falar com um humano, diga que vai chamar um atendente e use a tag [CHAMAR_ATENDENTE].`
};

// Simulando serviços externos que existiam no código original
const configService = { 
    getGeneralConfig: async () => botConfig, 
    updateGeneralConfig: async (cfg) => { botConfig = cfg } 
};
// Simulação de checkAvailability (Você deve conectar isso ao seu backend real se existir)
async function checkAvailability(dateStr) {
    // Mock para validação
    console.log(`Checando disponibilidade para: ${dateStr}`);
    // Exemplo: Retorna sempre disponível para teste
    return { status: 'success', available: true };
}

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
        console.log('🔄 Conectando ao MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Conectado ao MongoDB!');

        const store = new MongoStore({ mongoose: mongoose });
        
        console.log('🚀 Iniciando Cliente WhatsApp (Puppeteer)...');
        
        const client = new Client({
            authStrategy: new RemoteAuth({
                clientId: 'chacara-session-v2', // ID único da sessão no Mongo
                store: store,
                backupSyncIntervalMs: 60000 // Backup a cada 1 minuto
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
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
            // O RemoteAuth geralmente tenta reconectar sozinho, mas podemos monitorar
        });

        // --- MANIPULAÇÃO DE MENSAGENS ---
        client.on('message', async msg => {
            // Ignora status@broadcast
            if (msg.from === 'status@broadcast') return;

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

        app.get('/api/status', (req, res) => {
            res.json({
                connected: isConnected,
                qr_code: currentQrCode ? true : false,
                engine: 'Whatsapp-Web.js (Puppeteer)'
            });
        });

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
