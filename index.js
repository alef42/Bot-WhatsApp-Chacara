const { Client, LocalAuth } = require('whatsapp-web.js')
const qrcode = require('qrcode-terminal')
const fs = require('fs-extra')

// Cria uma nova instância do cliente com autenticação local
const client = new Client({
  authStrategy: new LocalAuth()
})

client.on('qr', qr => {
  // Gera o QR code para autenticação
  qrcode.generate(qr, { small: true })
})

client.on('ready', () => {
  // Informa que o WhatsApp Web está conectado
  console.log('WhatsApp Web conectado!')
})

client.on('authenticated', session => {
  // Informa que a autenticação foi bem-sucedida
  console.log('Autenticado com sucesso!')
})

client.on('auth_failure', msg => {
  // Informa que houve uma falha na autenticação
  console.error('Falha na autenticação', msg)
})

// Variável para rastrear o estado da conversa
let conversationState = {}

// Função para enviar as opções de preços e pacotes restantes
function sendPriceOptions(chatId) {
  const options =
    'Gostaria de saber mais sobre outros pacotes?\n1. Valores das diárias de Dezembro a Fevereiro\n2. Valores das diárias de Março a Novembro\n3. Valores das diárias em Feriados\n4. Pacote Carnaval\n5. Pacote Ano Novo\n6. Voltar ao menu principal'
  client.sendMessage(chatId, options)
}

// Evento para responder automaticamente às mensagens recebidas
client.on('message', message => {
  const chatId = message.from

  // Verifica se o estado da conversa já foi inicializado para o chatId
  if (!conversationState[chatId]) {
    conversationState[chatId] = 'initial'
    client.sendMessage(
      chatId,
      'Bem-vindo à Chácara da Paz🌞🍃! Agradecemos o contato, esperamos que esteja bem! 🤩'
    )
    setTimeout(() => {
      const options =
        'Agora, vamos lá! A Chácara da Paz conta com uma ótima estrutura para você e toda sua família. Como posso ajudar você hoje? Selecione uma das opções abaixo:\n1. Informações sobre a chácara\n2. Disponibilidade de datas\n3. Preços e pacotes\n4. Outras dúvidas'
      client.sendMessage(chatId, options)
    }, 1000)
  } else {
    switch (conversationState[chatId]) {
      case 'initial':
        // Responde com base na opção escolhida pelo usuário
        if (message.body === '1') {
          conversationState[chatId] = 'info'
          client.sendMessage(
            chatId,
            'A Chácara da Paz conta com 3 🛌🏻 quartos e acomodações para 20 pessoas. Nossa cozinha é equipada com fogão a gás, fogão industrial, geladeira e utensílios gerais. Temos uma smart TV, home theater, lareira interna, wi-fi, e muito mais! Quer saber mais sobre nossas áreas de lazer?\n1. Sim\n2. Não'
          )
        } else if (message.body === '2') {
          conversationState[chatId] = 'date'
          client.sendMessage(
            chatId,
            'Por favor, informe a data de interesse para locação no formato dd/mm/yyyy.'
          )
        } else if (message.body === '3') {
          conversationState[chatId] = 'prices'
          sendPriceOptions(chatId)
        } else if (message.body === '4') {
          conversationState[chatId] = 'other'
          client.sendMessage(
            chatId,
            'Por favor, digite sua dúvida e nossa equipe entrará em contato para ajudar você.'
          )
        } else {
          client.sendMessage(
            chatId,
            'Opção inválida. Por favor, selecione uma das opções numeradas.'
          )
        }
        break
      case 'info':
        // Responde com base na opção escolhida pelo usuário sobre as áreas de lazer
        if (message.body === '1') {
          client.sendMessage(
            chatId,
            'Contamos com 2 mesas de pebolim, 1 mesa de ping pong, 1 mesa de sinuca, um amplo campo de futebol, playground para crianças, piscina aquecida, espaço gourmet com fogão a lenha, 2 freezers para bebidas, e duas churrasqueiras. Também temos um espaço para festas com iluminação personalizada e sistema de som controlado pela ALEXA. E não podemos esquecer do espaço para fazer fogueira ao ar livre! 🪵🔥'
          )
          conversationState[chatId] = 'info_lazer'
          client.sendMessage(
            chatId,
            'Gostaria de saber mais sobre nossos pacotes de preços?\n1. Sim\n2. Não'
          )
        } else if (message.body === '2') {
          client.sendMessage(
            chatId,
            'Obrigado! Se precisar de mais informações, estamos à disposição.'
          )
          conversationState[chatId] = 'initial'
        } else {
          client.sendMessage(
            chatId,
            'Opção inválida. Por favor, selecione uma das opções numeradas.'
          )
        }
        break
      case 'info_lazer':
        // Responde com base na opção escolhida pelo usuário sobre pacotes de preços
        if (message.body === '1') {
          conversationState[chatId] = 'prices'
          sendPriceOptions(chatId)
        } else if (message.body === '2') {
          conversationState[chatId] = 'initial'
          const options =
            'Agora, vamos lá! A Chácara da Paz conta com uma ótima estrutura para você e toda sua família. Como posso ajudar você hoje? Selecione uma das opções abaixo:\n1. Informações sobre a chácara\n2. Disponibilidade de datas\n3. Preços e pacotes\n4. Outras dúvidas'
          client.sendMessage(chatId, options)
        } else {
          client.sendMessage(
            chatId,
            'Opção inválida. Por favor, selecione uma das opções numeradas.'
          )
        }
        break
      case 'date':
        // Verifica se a data está no formato correto
        if (message.body.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
          client.sendMessage(
            chatId,
            `Obrigado! Vamos verificar a disponibilidade para a data ${message.body} e entraremos em contato em breve.`
          )
          conversationState[chatId] = 'initial'
        } else {
          client.sendMessage(
            chatId,
            'Formato de data inválido. Por favor, informe a data no formato dd/mm/yyyy.'
          )
        }
        break
      case 'prices':
        // Responde com base na opção escolhida pelo usuário sobre preços e pacotes
        if (message.body === '1') {
          client.sendMessage(
            chatId,
            '🏖  Final de semana R$ 2.200\n- Check in na sexta às 18:00\n- Check out no domingo às 18:00\n\n1 Diária R$ 1.200\n- Check in às 08:00\n- Check out às 18:00'
          )
          sendPriceOptions(chatId)
        } else if (message.body === '2') {
          client.sendMessage(
            chatId,
            '☀️ Valores das diárias de Março a Novembro\nFinal de semana R$ 1.600\n- Check in na sexta às 18:00\n- Check out no domingo às 18:00\n\n1 Diária R$ 900\n- Check in às 08:00\n- Check out às 18:00'
          )
          sendPriceOptions(chatId)
        } else if (message.body === '3') {
          client.sendMessage(
            chatId,
            '⚽️ Valores das diárias em Feriados\nFinal de semana R$ 1.800\n- Check in na sexta às 18:00\n- Check out no domingo às 18:00\n\n1 Diária R$ 1.000\n- Check in às 08:00\n- Check out às 18:00'
          )
          sendPriceOptions(chatId)
        } else if (message.body === '4') {
          client.sendMessage(
            chatId,
            '🎉 Valor do pacote Carnaval\nReservamos no mínimo 3 diárias\nValor R$ 3.800\n- Check in às 08:00\n- Check out às 18:00'
          )
          sendPriceOptions(chatId)
        } else if (message.body === '5') {
          client.sendMessage(
            chatId,
            '🎊 Valor pacote Ano Novo 2025\nReservamos no mínimo 4 diárias\nValor R$ 8.200\n- Check in às 08:00\n- Check out às 18:00'
          )
          sendPriceOptions(chatId)
        } else if (message.body === '6') {
          conversationState[chatId] = 'initial'
          const options =
            'Agora, vamos lá! A Chácara da Paz conta com uma ótima estrutura para você e toda sua família. Como posso ajudar você hoje? Selecione uma das opções abaixo:\n1. Informações sobre a chácara\n2. Disponibilidade de datas\n3. Preços e pacotes\n4. Outras dúvidas'
          client.sendMessage(chatId, options)
        } else {
          client.sendMessage(
            chatId,
            'Opção inválida. Por favor, selecione uma das opções numeradas.'
          )
        }
        break
      case 'other':
        // Responde a outras dúvidas do usuário
        client.sendMessage(
          chatId,
          'Obrigado pela sua dúvida! Nossa equipe entrará em contato para ajudar você.'
        )
        conversationState[chatId] = 'initial'
        break

      default:
        // Responde a opções inválidas
        client.sendMessage(
          chatId,
          'Opção inválida. Por favor, selecione uma das opções numeradas.'
        )
        conversationState[chatId] = 'initial'
    }
  }
})

// Inicializa o cliente do WhatsApp Web
client.initialize()
