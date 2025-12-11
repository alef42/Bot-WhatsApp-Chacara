require('dotenv').config();
const mongoose = require('mongoose');
const { BufferJSON, initAuthCreds } = require('@whiskeysockets/baileys');

const uri = process.env.MONGO_URI;

// Schema identico ao usado
const AuthSchema = new mongoose.Schema({
    _id: String,
    data: Object
});
const AuthModel = mongoose.models.BaileysAuth || mongoose.model('BaileysAuth', AuthSchema);

async function testAdapter() {
    try {
        console.log("⏳ Conectando...");
        await mongoose.connect(uri);

        const key = 'test_buffer_integrity';
        const originalData = {
            noiseKey: Buffer.from('1234567890abcdef'),
            someString: 'hello'
        };

        console.log("Original Buffer isBuffer?", Buffer.isBuffer(originalData.noiseKey));

        // Simula a escrita (código do adapter)
        const payload = JSON.parse(JSON.stringify(originalData, BufferJSON.replacer));
        console.log("Payload to save:", JSON.stringify(payload));
        
        await AuthModel.findByIdAndUpdate(
            key, 
            { _id: key, data: payload },
            { upsert: true }
        );
        console.log("✅ Salvo no Mongo.");

        // Simula a leitura
        const res = await AuthModel.findById(key);
        if (!res) throw new Error("Não achou o registro");

        const recovered = JSON.parse(JSON.stringify(res.data), BufferJSON.reviver);
        
        console.log(" Recovered noiseKey isBuffer?", Buffer.isBuffer(recovered.noiseKey));
        console.log(" Recovered string:", recovered.someString);
        console.log(" Recovered content:", recovered.noiseKey.toString());

        if (Buffer.isBuffer(recovered.noiseKey) && recovered.noiseKey.toString() === '1234567890abcdef') {
            console.log("🎉 TESTE PASSOU: Integridade dos dados mantida!");
        } else {
            console.error("❌ TESTE FALHOU: Buffer não foi restaurado corretamente.");
        }

        await mongoose.disconnect();
    } catch (e) {
        console.error("Erro:", e);
    }
}

testAdapter();
