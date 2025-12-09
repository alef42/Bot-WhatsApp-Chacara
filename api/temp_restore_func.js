
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
