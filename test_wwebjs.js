const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

console.log('🚀 Iniciando Teste com Whatsapp-Web.js (Puppeteer)...');

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "client-one" }),
    puppeteer: {
        headless: true, // Mude para false se quiser ver o Chrome abrindo
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('📸 QR Code Recebido:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Cliente conectado e pronto!');
    console.log('Mande uma mensagem para o bot para testar.');
});

client.on('message', async msg => {
    console.log('📩 Mensagem recebida:', msg.body);
    if (msg.body === '!ping') {
        msg.reply('pong');
    }
});

client.on('disconnected', (reason) => {
    console.log('❌ Cliente desconectado:', reason);
});

client.initialize();
