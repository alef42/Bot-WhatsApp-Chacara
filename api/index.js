const { Client, LocalAuth } = require('whatsapp-web.js')
const qrcode = require('qrcode-terminal')
const express = require('express')
const path = require('path')
const axios = require('axios')

// Instância do cliente WhatsApp com autenticação local
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
})

client.on('qr', qr => qrcode.generate(qr, { small: true }))
client.on('ready', () => console.log('✅ WhatsApp Web conectado!'))
client.on('authenticated', () => console.log('🔑 Autenticado com sucesso!'))
client.on('auth_failure', msg =>
  console.error('❌ Falha na autenticação:', msg)
)

// Variáveis de controle
let conversationState = {}
let botActive = true // Estado do bot
const allowedNumber = '5511941093985@c.us' // Número autorizado
let attendantActive = {} // Inicializa o objeto
let inactivityTimers = {} // Armazena os temporizadores de inatividade

// Função para enviar o menu principal
function sendMainMenu(chatId) {
  const options =
    '🌿 Bem-vindo à Chácara da Paz! 🌞🍃\nComo posso ajudar hoje?\n\n1️⃣ Informações sobre a chácara\n3️⃣ Preços e pacotes\n4️⃣ Outras dúvidas'
  client.sendMessage(chatId, options)
}

// Função para enviar o menu de pacotes e preços
function sendPriceOptions(chatId) {
  const options =
    '💰 Tabela de Preços:\n1️⃣ Diárias de Dezembro a Fevereiro\n2️⃣ Diárias de Março a Novembro\n3️⃣ Feriados\n4️⃣ Pacote Carnaval\n5️⃣ Pacote Ano Novo\n6️⃣ 🔙 Voltar ao menu principal'
  client.sendMessage(chatId, options)
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

  console.log(`📩 Mensagem recebida de ${chatId}: ${message.body}`)

  // Verifica se o bot está ativo e se ninguém está digitando
  if (!botActive || attendantActive[chatId]) {
    console.log(`Bot está pausado para ${chatId}.`)
    return
  }

  // Comandos para ativar e desativar o bot
  if (message.body.toLowerCase() === 'ativar bot') {
    botActive = true
    await simulateTyping(chatId, '🤖 Bot ativado.')
    return
  } else if (message.body.toLowerCase() === 'desativar bot') {
    botActive = false
    await simulateTyping(chatId, '🤖 Bot desativado.')
    return
  }

  // Verifica se o número é autorizado
  //if (chatId !== allowedNumber) {
  //console.log(`Número não autorizado: ${chatId}`)
  // return
  //}

  // Reinicia o temporizador de inatividade
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
      simulateTyping(
        chatId,
        '❌ Opção inválida! Escolha uma das opções numeradas.'
      )
  }
}

function handleInitialResponse(chatId, userMessage) {
  switch (userMessage.trim()) {
    case '1':
      conversationState[chatId] = 'info'
      simulateTyping(
        chatId,
        '🏡 A Chácara da Paz conta com 3 quartos e acomodações para 20 pessoas. Quer saber mais sobre a área de lazer?\n1️⃣ Sim\n2️⃣ Não'
      )
      break
    case '3':
      conversationState[chatId] = 'prices'
      sendPriceOptions(chatId)
      break
    case '4':
      conversationState[chatId] = 'other'
      simulateTyping(
        chatId,
        '❓ Digite sua dúvida, e nossa equipe responderá em breve!'
      )
      break
    default:
      simulateTyping(
        chatId,
        '❌ Opção inválida! Escolha uma das opções numeradas.'
      )
  }
}

function handleInfoResponse(chatId, userMessage) {
  switch (userMessage.trim()) {
    case '1':
      simulateTyping(
        chatId,
        'Contamos com 2 mesas de pebolim, 1 mesa de ping pong, 1 mesa de sinuca, um amplo campo de futebol, playground para crianças, piscina aquecida, espaço gourmet com fogão a lenha, 2 freezers para bebidas, e duas churrasqueiras. Também temos um espaço para festas com iluminação personalizada e sistema de som controlado pela ALEXA. E não podemos esquecer do espaço para fazer fogueira ao ar livre! 🪵🔥'
      )
      conversationState[chatId] = 'info_lazer'
      simulateTyping(
        chatId,
        'Gostaria de saber mais sobre nossos pacotes de preços?\n1️⃣ Sim\n2️⃣ Não'
      )
      break
    case '2':
      simulateTyping(
        chatId,
        'Obrigado! Se precisar de mais informações, estamos à disposição.'
      )
      conversationState[chatId] = 'initial'
      sendMainMenu(chatId)
      break
    default:
      simulateTyping(
        chatId,
        '❌ Opção inválida! Escolha uma das opções numeradas.'
      )
  }
}

function handleInfoLazerResponse(chatId, userMessage) {
  switch (userMessage.trim()) {
    case '1':
      conversationState[chatId] = 'prices'
      sendPriceOptions(chatId)
      break
    case '2':
      conversationState[chatId] = 'initial'
      sendMainMenu(chatId)
      break
    default:
      simulateTyping(
        chatId,
        '❌ Opção inválida! Escolha uma das opções numeradas.'
      )
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
      simulateTyping(
        chatId,
        '❌ Opção inválida! Escolha uma das opções numeradas.'
      )
      sendPriceOptions(chatId)
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
      simulateTyping(
        chatId,
        '❌ Opção inválida! Escolha uma das opções numeradas.'
      )
  }
}

function handleDateResponse(chatId, userMessage) {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(userMessage.trim())) {
    simulateTyping(
      chatId,
      `📆 Vamos verificar a disponibilidade para ${userMessage}. Aguarde nosso retorno.`
    )
    sendToPortal({ chatId, date: userMessage })
    // Pausa o bot após receber a data
    botActive = false
  } else {
    simulateTyping(chatId, '⚠️ Formato de data inválido. Use dd/mm/yyyy')
  }
}

function handleOtherResponse(chatId) {
  simulateTyping(chatId, '📨 Obrigado! Nossa equipe responderá em breve.')
  // Pausa o bot após receber a dúvida
  botActive = false
}

// Evento para detectar quando um atendente assume a conversa
client.on('typing', chat => {
  const chatId = chat.id._serialized
  console.log(`Evento 'typing' disparado para ${chatId}`) // Verificação adicional
  if (chatId) {
    attendantActive[chatId] = true
    console.log(`Atendente começou a digitar em ${chatId}. Bot pausado.`)
  }
})

client.on('message_ack', (msg, ack) => {
  const chatId = msg.from
  if (ack === 3 && chatId === allowedNumber) {
    attendantActive[chatId] = true
    console.log(`Mensagem lida em ${chatId}. Bot pausado.`)
  }
})

// Inicializa o cliente do WhatsApp Web
client.initialize()

// Configuração do servidor Express.js
const app = express()
const port = 3000

app.use(express.json())

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

// Rota para servir o arquivo HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'))
})

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`)
})
