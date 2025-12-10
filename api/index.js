const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');

// ... imports anteriores
const qrcode = require('qrcode-terminal')
const express = require('express')
const path = require('path')
const axios = require('axios')
const cors = require('cors')
const { GoogleGenerativeAI } = require('@google/generative-ai')
const fs = require('fs');
const { checkUpcomingReservations, checkAvailability } = require('./services/reservationService');
const configService = require('./services/configService');
const scheduleService = require('./services/scheduleService');
const moment = require('moment');

// ... variáveis globais

// Inicialização de Serviços e DB
async function initializeServices() {
    try {
        console.log('🔄 Carregando configurações do Firebase...');
        botConfig = await configService.getGeneralConfig();
        monitorConfig = await configService.getMonitorConfig();
        schedules = await scheduleService.getAllSchedules();
        console.log('✅ Configurações carregadas com sucesso!');

        // Conectar ao MongoDB se houver URI (Produção)
        if (process.env.MONGO_URI) {
            console.log('🔄 Conectando ao MongoDB...');
            await mongoose.connect(process.env.MONGO_URI);
            console.log('✅ Conectado ao MongoDB!');
        } else {
            console.log('⚠️ MONGO_URI não definido. Usando LocalAuth (apenas dev).');
        }

    } catch (error) {
        console.error('❌ Erro fatal na inicialização:', error);
    }
}

let client;

// Inicializa o Client APÓS conectar ao banco (se necessário)
async function startBot() {
    await initializeServices();

    console.log('🚀 Iniciando Bot WhatsApp...');

    let authStrategy;
    if (process.env.MONGO_URI) {
        const store = new MongoStore({ mongoose: mongoose });
        authStrategy = new RemoteAuth({
            store: store,
            backupSyncIntervalMs: 60000 // Salva sessão a cada 1 min
        });
        console.log('🔐 Usando RemoteAuth (Database Persistence)');
    } else {
        authStrategy = new LocalAuth();
        console.log('📂 Usando LocalAuth (File Persistence)');
    }

    client = new Client({
        authStrategy: authStrategy,
        authTimeoutMs: 60000,
        puppeteer: {
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ],
            headless: true
        }
    });

    // Configura o rastreamento de mensagens (Monkey Patch)
    setupMessageTracking(client);

    let currentQrCode = null;
    let isConnected = false;

    // ... Eventos do Client ...
    client.on('qr', qr => {
        currentQrCode = qr;
        isConnected = false;
        qrcode.generate(qr, { small: true });
        console.log('📸 QR Code gerado! Escaneie para conectar.');
    });

    client.on('ready', () => {
        console.log('✅ WhatsApp Web conectado!');
        isConnected = true;
        currentQrCode = null;
    });
    
    client.on('remote_session_saved', () => {
        console.log('💾 Sessão salva no banco de dados!');
    });

    client.on('authenticated', () => {
        console.log('🔑 Autenticado com sucesso!');
    });

    client.on('disconnected', async (reason) => {
        console.log('❌ Cliente desconectado:', reason);
        isConnected = false;
        currentQrCode = null;
        
        try {
           if(client) await client.destroy();
        } catch (e) { console.error('Erro ao destruir:', e); }
        
        console.log('🔄 Tentando reconectar automaticamente...');
        if(client) client.initialize();
    });
    
    // ... Resto dos eventos ...
    client.on('auth_failure', msg => {
        console.error('❌ Falha na autenticação:', msg);
        isConnected = false;
    });

    client.on('loading_screen', (percent, message) => {
        console.log('⏳ Carregando:', percent, '%', message);
    });

    client.on('change_state', state => {
        console.log('🔄 Estado da conexão alterado:', state);
    });

    // Evento para detectar mensagens enviadas (incluindo as do humano)
    client.on('message_create', async (msg) => {
        if (msg.fromMe) {
            // Aguarda um pouco para garantir que o ID foi adicionado ao Set se foi o bot
            await new Promise(resolve => setTimeout(resolve, 500));
            // Verifica no Set do próprio cliente
            if (client.botMessages && client.botMessages.has(msg.id._serialized)) {
                console.log('🤖 Mensagem do bot ignorada (loop prevention).');
                return;
            }
            // Se for mensagem de um humano real (via WhatsApp Web/Celular), tratamos como comando
            console.log('👤 Mensagem enviada por humano (admin):', msg.body);
        }
    });

    // Evento para detectar quando um atendente assume a conversa (DIGITANDO)
    client.on('typing', chat => {
        const chatId = chat.id._serialized
        if (chatId) {
            attendantActive[chatId] = true
            console.log(`Atendente começou a digitar em ${chatId}. Bot pausado.`)
        }
    })

    // Inicializa
    client.initialize();
}

// Inicia tudo
startBot();

// Variáveis de controle
let conversationState = {}
let botActivePerUser = {} // Estado do bot por usuário

const allowedNumber = '5511941093985@c.us' // Número autorizado
let attendantActive = {} // Inicializa o objeto
let inactivityTimers = {} // Armazena os temporizadores de inatividade
let attendantInactivityTimers = {} // Armazena os temporizadores de inatividade do atendente

// Função para iniciar ou reiniciar o temporizador de inatividade do atendente
function resetAttendantInactivityTimer(chatId) {
  if (attendantInactivityTimers[chatId]) {
    clearTimeout(attendantInactivityTimers[chatId])
  }
  attendantInactivityTimers[chatId] = setTimeout(() => {
    attendantActive[chatId] = false
    conversationState[chatId] = 'initial' // Reseta o estado da conversa
    console.log(`🤖 Bot reativado para ${chatId} após 20 minutos de inatividade do atendente.`)
  }, 20 * 60 * 1000) // 20 minutos
}

// Função auxiliar para inicializar o Monkey Patch (Rastreamento de Mensagens)
function setupMessageTracking(clientInstance) {
    const botMessages = new Set();
    const originalSendMessage = clientInstance.sendMessage.bind(clientInstance);

    clientInstance.sendMessage = async (chatId, content, options) => {
        const msg = await originalSendMessage(chatId, content, options);
        if (msg && msg.id) {
            botMessages.add(msg.id._serialized);
            // Limpeza simples para evitar vazamento de memória
            setTimeout(() => botMessages.delete(msg.id._serialized), 600000);
        }
        return msg;
    };
    // Exporta o Set para uso global se necessário, ou anexa ao cliente
    clientInstance.botMessages = botMessages;
}

// Evento movido para startBot

// Função para enviar o menu principal
function sendMainMenu(chatId) {
  const options =
    '🌿 *Bem-vindo à Chácara da Paz!* 🌞🍃\n\nComo posso ajudar hoje?\n\n1️⃣ *Consultar Disponibilidade de Data*\n2️⃣ *Verificar Itens de Lazer*\n3️⃣ *Falar com Atendente*\n\n_Digite o número ou o nome da opção._'
  client.sendMessage(chatId, options)
}

// Função para enviar o menu de pacotes e preços
function sendPriceOptions(chatId) {
  const options =
    '💲 *Tabela de Preços e Pacotes*\n\n' +
    'Para ver os valores atualizados e disponibilidade, acesse nosso site:\n' +
    '👉 https://chacaradapazv2.netlify.app/\n\n' +
    '_Lá você consegue simular datas e fechar sua reserva na hora!_ 😉'
  
  client.sendMessage(chatId, options)
  
  // Como não há mais menu de preços, volta para o estado inicial para aceitar qualquer comando
  conversationState[chatId] = 'initial'
}

// Função para enviar dados para o portal
function sendToPortal(data) {
  console.log('📡 Enviando dados para o portal:', data)
  axios
    .post('http://localhost:3000/api/requests', data)
    .then(response => console.log('✅ Dados enviados:', response.data))
    .catch(error => console.error('❌ Erro ao enviar:', error))
}

// Função para iniciar ou reiniciar o temporizador de inatividade
function resetInactivityTimer(chatId) {
  if (inactivityTimers[chatId]) {
    clearTimeout(inactivityTimers[chatId])
  }
  inactivityTimers[chatId] = setTimeout(async () => {
    await client.sendMessage(
      chatId,
      'Você ainda está aí? Precisa de mais alguma coisa?'
    )
    await client.sendMessage(
      chatId,
      'O atendimento foi encerrado. Se precisar de mais alguma coisa, estou aqui para ajudar!'
    )
    sendMainMenu(chatId)
  }, 300000) // 5 minutos de inatividade
}

// Função para simular digitação
async function simulateTyping(chatId, messages, isMenu = false) {
  const chat = await client.getChatById(chatId)
  if (!Array.isArray(messages)) messages = [messages]
  for (const message of messages) {
    await chat.sendStateTyping()
    await new Promise(resolve => setTimeout(resolve, isMenu ? 50000 : 3000))
    await client.sendMessage(chatId, message)
    await chat.clearState()
    await new Promise(resolve => setTimeout(resolve, isMenu ? 20000 : 3000))
  }
}

// Evento para responder automaticamente às mensagens recebidas
client.on('message', async message => {
  const chatId = message.from

  // Ignora atualizações de status
  if (chatId === 'status@broadcast' || message.isStatus) return;

  // --- COMANDOS ESPECIAIS MANUAIS ---
  if (message.body === '!grupos') {
    const chats = await client.getChats();
    const groups = chats.filter(chat => chat.isGroup);
    if (groups.length === 0) {
        await client.sendMessage(chatId, 'Não encontrei nenhum grupo.');
    } else {
        let msg = '*Grupos Encontrados:*\n\n';
        groups.forEach(g => {
            msg += `Nome: ${g.name}\nID: ${g.id._serialized}\n\n`;
        });
        await client.sendMessage(chatId, msg);
    }
    return;
  }

  // Debug: Forçar verificação de reservas
  if (message.body === '!check') {
      await client.sendMessage(chatId, '🔎 Rodando verificação manual de reservas...');
      await runReservationCheck();
      return;
  }
  
  // Log para debug
  console.log(`📩 Mensagem recebida de ${chatId}: ${message.body}`)

    // --- CONTROLE DE ACESSO ---
    // 1. Verifica se está em modo de teste
    if (botConfig.testMode) {
        // Se estiver em modo teste, SÓ responde aos números permitidos
        // Normaliza o ID para verificar apenas o número se necessário, ou ID completo
        const isAllowed = botConfig.allowedNumbers && botConfig.allowedNumbers.some(num => chatId.includes(num));
        if (!isAllowed) {
            console.log(`⛔ Bloqueado pelo Modo Teste: ${chatId}`);
            return; // Ignora silenciosamente
        }
    }

    // 2. Verifica se o número está bloqueado explicitly
    if (botConfig.blockedNumbers && botConfig.blockedNumbers.some(num => chatId.includes(num))) {
        console.log(`🚫 Número bloqueado: ${chatId}`);
        return; // Ignora silenciosamente
    }

    // Verifica se o bot está ativo e se ninguém está digitando
    if (botActivePerUser[chatId] === false || attendantActive[chatId]) {
    console.log(`Bot está pausado para ${chatId}.`)
    if (attendantActive[chatId]) {
        resetAttendantInactivityTimer(chatId);
    }
    return
  }

  // Comandos para ativar e desativar o bot
  if (message.body.toLowerCase() === 'ativar bot') {
    botActivePerUser[chatId] = true
    await simulateTyping(chatId, '🤖 Bot ativado.')
    return
  } else if (message.body.toLowerCase() === 'desativar bot') {
    botActivePerUser[chatId] = false
    await simulateTyping(chatId, '🤖 Bot desativado.')
    return
  }

  // Verifica se o número é autorizado (Desativado)
  /* if (chatId !== allowedNumber) {
    // return
  } */

  resetInactivityTimer(chatId)

  if (!conversationState[chatId]) {
    conversationState[chatId] = 'initial'
    sendMainMenu(chatId)
  } else {
    handleUserResponse(chatId, message.body)
  }
})

// Lógica do fluxo de conversa
function handleUserResponse(chatId, userMessage) {
  switch (conversationState[chatId]) {
    case 'initial':
      handleInitialResponse(chatId, userMessage)
      break
    case 'info':
      handleInfoResponse(chatId, userMessage)
      break
    case 'info_lazer':
      handleInfoLazerResponse(chatId, userMessage)
      break
    case 'prices':
      handlePricesResponse(chatId, userMessage)
      break
    case 'other':
      handleOtherResponse(chatId)
      break
    case 'price_options':
      handlePriceOptionsResponse(chatId, userMessage)
      break
    case 'date':
      handleDateResponse(chatId, userMessage)
      break
    default:
      // Se o estado não for reconhecido, volta pro início ou usa IA
      conversationState[chatId] = 'initial'
      handleAIResponse(chatId, userMessage)
  }
}

function handleInitialResponse(chatId, userMessage) {
  const msg = userMessage.trim().toLowerCase()
  
  if (msg === '1' || msg.includes('disponibilidade') || msg.includes('reserva') || msg.includes('data')) {
      conversationState[chatId] = 'date'
      simulateTyping(chatId, '📅 Para verificar a disponibilidade, por favor me informe a *data de entrada* desejada.\n\nFormato: *Dia/Mês/Ano* (Ex: 10/12/2024)')
  } else if (msg === '2' || msg.includes('informações') || msg.includes('info') || msg.includes('lazer')) {
      conversationState[chatId] = 'info'
      simulateTyping(
        chatId,
        '🏊‍♂️ *Lazer e Estrutura*\n\n' +
        'Nossa chácara é completa! Temos piscina, churrasqueira, campo de futebol e muito mais.\n\n' +
        'Deseja ver a lista completa de itens de lazer?\n' +
        '1️⃣ *Sim, mostrar tudo*\n' +
        '2️⃣ *Voltar ao menu*'
      )
  } else if (msg === '3' || msg.includes('atendente') || msg.includes('falar')) {
      simulateTyping(
        chatId,
        '✅ Chamando um atendente! 🏃💨\n\nAguarde um instante que nossa equipe já vai te responder.\n(O bot ficará pausado durante o atendimento)'
      )
      // Pausa o bot imediatamente
      botActivePerUser[chatId] = false
      attendantActive[chatId] = true
  } else {
      // Se não for uma opção válida do menu, usa a IA
      handleAIResponse(chatId, msg)
  }
}

function handleInfoResponse(chatId, userMessage) {
  const msg = userMessage.trim().toLowerCase()
  if (msg === '1' || msg === 'sim') {
      simulateTyping(
        chatId,
        '✅ *Confira nossa estrutura:*\n\n' +
        '🎱 2 Mesas de Pebolim\n' +
        '🏓 1 Mesa de Ping Pong\n' +
        '🎱 1 Mesa de Sinuca\n' +
        '⚽ Amplo Campo de Futebol\n' +
        '🛝 Playground para Crianças\n' +
        '🏊 Piscina Aquecida\n' +
        '🍳 Espaço Gourmet com Fogão a Lenha\n' +
        '🧊 2 Freezers\n' +
        '🍖 2 Churrasqueiras\n' +
        '💡 Espaço de Festas com Iluminação\n' +
        '🔊 Som com Alexa\n' +
        '🔥 Fogueira ao Ar Livre\n\n' +
        'Gostaria de ver nossos preços agora?\n' +
        '1️⃣ *Ver Preços*\n' +
        '2️⃣ *Voltar ao Menu*'
      )
      conversationState[chatId] = 'info_lazer'
  } else if (msg === '2' || msg === 'não') {
      simulateTyping(
        chatId,
        'Obrigado! Se precisar de mais informações, estamos à disposição.'
      )
      conversationState[chatId] = 'initial'
      sendMainMenu(chatId)
  } else {
      simulateTyping(chatId, '❌ Opção inválida. Responda com 1 (Sim) ou 2 (Não).')
  }
}

function handleInfoLazerResponse(chatId, userMessage) {
  const msg = userMessage.trim().toLowerCase()
  if (msg === '1' || msg === 'sim') {
      // conversationState[chatId] = 'prices'  <-- Não precisa mais, pois sendPriceOptions já reseta para initial
      sendPriceOptions(chatId)
  } else if (msg === '2' || msg === 'não') {
      conversationState[chatId] = 'initial'
      sendMainMenu(chatId)
  } else {
      simulateTyping(chatId, '❌ Opção inválida. Responda com 1 (Sim) ou 2 (Não).')
  }
}

function handlePricesResponse(chatId, userMessage) {
  switch (userMessage.trim()) {
    case '1':
      simulateTyping(
        chatId,
        '🏖  Final de semana R$ 2.200\n- Check in na sexta às 18:00\n- Check out no domingo às 18:00\n\n1 Diária R$ 1.200\n- Check in às 08:00\n- Check out às 18:00'
      )
      break
    case '2':
      simulateTyping(
        chatId,
        '☀️ Valores das diárias de Março a Novembro\nFinal de semana R$ 1.600\n- Check in na sexta às 18:00\n- Check out no domingo às 18:00\n\n1 Diária R$ 900\n- Check in às 08:00\n- Check out às 18:00'
      )
      break
    case '3':
      simulateTyping(
        chatId,
        '⚽️ Valores das diárias em Feriados\nFinal de semana R$ 1.800\n- Check in na sexta às 18:00\n- Check out no domingo às 18:00\n\n1 Diária R$ 1.000\n- Check in às 08:00\n- Check out às 18:00'
      )
      break
    case '4':
      simulateTyping(
        chatId,
        '🎉 Valor do pacote Carnaval\nReservamos no mínimo 3 diárias\nValor R$ 3.800\n- Check in às 08:00\n- Check out às 18:00'
      )
      break
    case '5':
      simulateTyping(
        chatId,
        '🎊 Valor pacote Ano Novo 2025\nReservamos no mínimo 4 diárias\nValor R$ 8.200\n- Check in às 08:00\n- Check out às 18:00'
      )
      break
    default:
      simulateTyping(chatId, '❌ Opção inválida. Por favor, escolha uma das opções do menu ou digite "Voltar" para o inicio.')
      return
  }
  conversationState[chatId] = 'price_options'
  simulateTyping(
    chatId,
    'O que você gostaria de fazer agora?\n1️⃣ Verificar disponibilidade de data\n2️⃣ Voltar ao menu principal'
  )
}

function handlePriceOptionsResponse(chatId, userMessage) {
  switch (userMessage.trim()) {
    case '1':
      conversationState[chatId] = 'date'
      simulateTyping(chatId, '📅 Informe a data desejada (dd/mm/yyyy)')
      break
    case '2':
      conversationState[chatId] = 'initial'
      sendMainMenu(chatId)
      break
    default:
      simulateTyping(chatId, '❌ Opção inválida. Escolha 1 ou 2.')
  }
}

async function handleDateResponse(chatId, userMessage) {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(userMessage.trim())) {
    simulateTyping(
      chatId,
      '📆 Verificando disponibilidade no nosso sistema...'
    )
    
    // Pausa o bot para evitar respostas cruzadas
    botActivePerUser[chatId] = false

    const result = await checkAvailability(userMessage.trim());

    if (result.status === 'error') {
         await client.sendMessage(chatId, '❌ Ops! Tive um problema ao consultar a agenda. Tente novamente mais tarde.');
    } else if (result.available) {
         await client.sendMessage(chatId, '✅ *Data Disponível!* 🎉\n\nEssa data está livre! Gostaria de fazer sua reserva agora pelo nosso site?\n👉 https://chacaradapazv2.netlify.app/');
    } else {
         const conflict = result.conflict;
         await client.sendMessage(chatId, `❌ *Data Indisponível* 😕\n\nJá temos uma reserva confirmada para esse período:\n🗓️ ${conflict.start} até ${conflict.end}\n\nPor favor, escolha outra data.`);
    }

    // Retorna para o menu inicial automaticamente
    conversationState[chatId] = 'initial'
    botActivePerUser[chatId] = true // Reativa o bot
    // sendMainMenu(chatId) // Opcional: mandar o menu de novo ou não
  } else {
    // Se não parecer uma data, avisa o formato
    simulateTyping(chatId, '⚠️ Formato inválido. Por favor, digite a data no formato dia/mês/ano (ex: 25/12/2025).')
  }
}

function handleOtherResponse(chatId, userMessage) {
    // Mantemos a IA aqui para dúvidas gerais, mas se falhar é ok
    handleAIResponse(chatId, userMessage)
}

async function handleAIResponse(chatId, userMessage) {
  // 1. Interceptador de Navegação (Palavras-chave)
  const msg = userMessage.trim().toLowerCase()
  if (['menu', 'voltar', 'inicio', 'início', 'cancelar', '0', 'sair'].includes(msg)) {
      conversationState[chatId] = 'initial'
      sendMainMenu(chatId)
      return
  }

  // Simula digitando para dar feedback imediato
  simulateTyping(chatId, '')

  try {
    const prompt = botConfig.systemPrompt.replace('${userMessage}', userMessage);

    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text().trim()

    if (text.includes('[CHAMAR_ATENDENTE]')) {
        await client.sendMessage(chatId, 'Hum, essa eu não sei responder... 🤔\nVou chamar alguém da nossa equipe para te ajudar! 🏃💨\n\n(Aguarde um instante)')
        botActivePerUser[chatId] = false
        attendantActive[chatId] = true
        return
    }

    await client.sendMessage(chatId, text)
    
  } catch (error) {
    console.error('Erro na IA:', error)
    
    if (error.status === 429) {
         client.sendMessage(chatId, 'Estou com muita demanda agora! 🤯 Para não te fazer esperar, use nosso menu manual:')
         conversationState[chatId] = 'initial'
         sendMainMenu(chatId)
    } else if (error.status === 403) {
        client.sendMessage(chatId, 'Minha conexão de segurança barrou essa resposta. 🛡️ Tente perguntar de outra forma.')
    } else if (error.status === 503) {
        client.sendMessage(chatId, 'Minha conexão com o cérebro (Google) está oscilando um pouco. 📡 Tente perguntar novamente em alguns instantes.')
    } else {
        client.sendMessage(chatId, 'Desculpe, estou com dificuldade para pensar agora. 🤯 Mas aqui está nosso menu para te ajudar:')
        sendMainMenu(chatId)
    }
  }
}

// Evento movido para startBot

/* REMOVIDO: Causava pausa indesejada apenas ao visualizar a mensagem
client.on('message_ack', (msg, ack) => {
  const chatId = msg.from
  if (ack === 3 && chatId) {
    attendantActive[chatId] = true
    console.log(`Mensagem lida em ${chatId}. Bot pausado.`)
  }
})
*/

// Inicializa o cliente do WhatsApp Web
client.initialize()

// Configuração do servidor Express.js

const app = express()
const port = 4000

app.use(express.json())
app.use(cors()) // Habilita CORS para todas as origens

let requests = []

// Endpoint para receber dados do WhatsApp
app.post('/api/requests', (req, res) => {
  const request = req.body
  requests.push(request)
  res.status(201).send('Solicitação recebida')
})

// Endpoint para listar todas as solicitações
app.get('/api/requests', (req, res) => {
  res.json(requests)
})

// Endpoint para obter status do bot
app.get('/api/status', (req, res) => {
    res.json({
        connected: isConnected,
        qr_code: currentQrCode ? true : false // Retorna se tem QR disponível
    });
});

// Endpoint para obter o QR Code (texto puro para gerar imagem no front)
app.get('/api/qr', (req, res) => {
    if (currentQrCode) {
        res.json({ qr: currentQrCode });
    } else {
        res.status(404).json({ error: 'QR Code não disponível (bot já conectado ou iniciando)' });
    }
});

// Endpoint para obter o prompt atual da IA
app.get('/api/prompt', (req, res) => {
    res.json({ prompt: botConfig.systemPrompt });
});

// Endpoint para atualizar configuração do bot
// Endpoint para atualizar configuração do bot
app.post('/api/bot-config', async (req, res) => {
    const { systemPrompt, testMode, allowedNumbers, blockedNumbers } = req.body;
    
    // Update local memory
    if (systemPrompt !== undefined) botConfig.systemPrompt = systemPrompt;
    if (testMode !== undefined) botConfig.testMode = testMode;
    if (allowedNumbers !== undefined) botConfig.allowedNumbers = allowedNumbers;
    if (blockedNumbers !== undefined) botConfig.blockedNumbers = blockedNumbers;

    // Persist to Firebase
    const success = await configService.updateGeneralConfig(botConfig);

    if (success) {
        console.log('💾 Configuração Geral salva no Firebase.');
        res.json({ success: true, config: botConfig });
    } else {
        res.status(500).json({ error: 'Falha ao salvar no banco de dados.' });
    }
});

// Endpoint para ler configuração do bot
app.get('/api/bot-config', (req, res) => {
    // Retorna da memória (que foi carregada na inicialização ou atualizada via POST)
    res.json(botConfig);
});

// Endpoint para atualizar prompt do sistema
app.post('/api/update-prompt', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt é obrigatório.' });
    
    botConfig.systemPrompt = prompt;
    const success = await configService.updateGeneralConfig(botConfig);

    if (success) {
        console.log('📝 Prompt atualizado via API.');
        res.json({ message: 'Prompt atualizado com sucesso.' });
    } else {
         res.status(500).json({ error: 'Falha ao salvar prompt.' });
    }
});

// Endpoint para reiniciar o cliente WhatsApp
app.post('/api/restart', async (req, res) => {
    try {
        console.log('🔄 Reiniciando cliente WhatsApp via API...');
        isConnected = false;
        await client.destroy();
        await client.initialize();
        res.json({ message: 'Reinicialização iniciada.' });
    } catch (error) {
        console.error('Erro ao reiniciar:', error);
        res.status(500).json({ error: 'Falha ao reiniciar.' });
    }
});

// Endpoint para despausar/reativar o bot para o número padrão
app.post('/api/unpause', async (req, res) => {
    try {
        const chatId = allowedNumber;
        attendantActive[chatId] = false;
        botActivePerUser[chatId] = true;
        
        await client.sendMessage(chatId, '🤖 Bot reativado pelo painel administrativo.');
        res.json({ message: 'Bot reativado com sucesso.' });
    } catch (error) {
        console.error('Erro ao despausar:', error);
        res.status(500).json({ error: 'Falha ao despausar.' });
    }
});

// --- AGENDAMENTO DE MENSAGENS E MONITORAMENTO ---
// --- AGENDAMENTO DE MENSAGENS E MONITORAMENTO ---

// Endpoints de Agendamento
app.get('/api/schedules', async (req, res) => {
    // Sempre busca fresco do banco para garantir sincronia
    schedules = await scheduleService.getAllSchedules();
    res.json(schedules);
});

app.post('/api/schedules', async (req, res) => {
    const { phone, message, time, days, name } = req.body;
    if (!phone || !message || !time || !days) return res.status(400).json({ error: 'Campos obrigatórios.' });

    try {
        const newSchedule = {
            name: name || '',
            phone: phone.replace(/\D/g, ''),
            message,
            time,
            days,
            lastSent: null
        };
        
        const created = await scheduleService.addSchedule(newSchedule);
        schedules.push(created); // Atualiza memória local
        res.json({ message: 'Criado.', schedule: created });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao criar agendamento.' });
    }
});

app.delete('/api/schedules/:id', async (req, res) => {
    try {
        await scheduleService.deleteSchedule(req.params.id);
        schedules = schedules.filter(s => s.id !== req.params.id); // Atualiza memória local
        res.json({ message: 'Deletado.' });
    } catch (error) {
         res.status(500).json({ error: 'Erro ao deletar.' });
    }
});

// Endpoints de Configuração do Monitor
app.get('/api/monitor-config', (req, res) => res.json(monitorConfig));

app.post('/api/monitor-config', async (req, res) => {
    monitorConfig = { ...monitorConfig, ...req.body };
    const success = await configService.updateMonitorConfig(monitorConfig);
    
    if (success) {
        res.json({ message: 'Configuração salva.', config: monitorConfig });
    } else {
        res.status(500).json({ error: 'Erro ao salvar configuração.' });
    }
});

app.post('/api/monitor-run', async (req, res) => {
    res.json({ message: 'Execução iniciada em background.' });
    runReservationCheck();
});

// --- FUNÇÃO DE MONITORAMENTO ---
async function runReservationCheck() {
    if (!client.info || !monitorConfig.enabled) return;

    console.log('🔍 Executando verificação de reservas...');
    const alerts = await checkUpcomingReservations();

    if (alerts.length > 0 && monitorConfig.recipients.length > 0) {
        for (const alert of alerts) {
            for (const recipient of monitorConfig.recipients) {
                try {
                    // Formata número para ID do WhatsApp (5511999999999@c.us)
                    const chatId = recipient.replace(/\D/g, '') + '@c.us';
                    await client.sendMessage(chatId, alert.message);
                } catch (error) {
                    console.error(`Erro ao enviar alerta para ${recipient}:`, error);
                }
            }
        }
    }
}

// Configura o intervalo de verificação (ex: a cada minuto verifica se deu o horário)
setInterval(() => {
    const now = moment().format('HH:mm');
    if (monitorConfig.enabled && now === monitorConfig.checkTime) {
         runReservationCheck();
    }
}, 60000); 

// Rota para servir o arquivo HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

app.listen(port, () => {
    console.log(`✅ Servidor rodando em http://localhost:${port} - Versão 2.1 (Com Moment)`);
})
