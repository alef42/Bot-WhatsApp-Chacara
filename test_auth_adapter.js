const mongoose = require('mongoose');
const useMongoAuthState = require('./api/services/baileysMongoAuth');
const { BufferJSON } = require('@whiskeysockets/baileys');

const uri = "mongodb+srv://alefsantos4255_db_user:JoVNwgweibGd5aXy@cluster0.2zms3ia.mongodb.net/whatsapp_bot?appName=Cluster0";

async function testAdapter() {
    try {
        console.log('🔄 Conectando MongoDB...');
        await mongoose.connect(uri);

        console.log('🛠️ Iniciando teste do Adapter...');
        const auth = await useMongoAuthState();
        
        // Mock Data com Buffer
        const key = 'test-key';
        const mockData = {
            someBuffer: Buffer.from('Hello World'),
            someString: 'Test'
        };

        console.log('💾 Salvando dados de teste...', mockData);
        await auth.state.keys.set({ 'test-category': { [key]: mockData } });

        console.log('📖 Lendo dados de volta...');
        const readData = await auth.state.keys.get('test-category', [key]);
        
        const result = readData[key];
        console.log('📦 Resultado:', result);

        if (result && Buffer.isBuffer(result.someBuffer) && result.someBuffer.toString() === 'Hello World') {
            console.log('✅ SUCESSO! Buffer preservado.');
        } else {
            console.error('❌ FALHA! Buffer corrompido ou não é Buffer instance.');
            console.log('Tipo:', typeof result.someBuffer);
            console.log('Is Buffer?', Buffer.isBuffer(result.someBuffer));
        }

        // Limpeza
        console.log('🧹 Limpando teste...');
        await auth.state.keys.set({ 'test-category': { [key]: null } });

    } catch (e) {
        console.error('❌ Erro no teste:', e);
    } finally {
        await mongoose.disconnect();
    }
}

testAdapter();
