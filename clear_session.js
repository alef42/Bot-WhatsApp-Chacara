const mongoose = require('mongoose');

// Link do banco (substitua se necessário, ou pegue do ambiente)
// Como é local, vamos tentar pegar o que você usou no teste, ou pedir para digitar
// Mas para facilitar, vou hardcodar o que funcionou antes ou pegar do ENV se rodar no servidor

const uri = "mongodb+srv://alefsantos4255_db_user:JoVNwgweibGd5aXy@cluster0.2zms3ia.mongodb.net/whatsapp_bot?appName=Cluster0";

async function clearSession() {
    try {
        console.log('🔄 Conectando para limpar sessão...');
        await mongoose.connect(uri);
        
        // O nome da collection definido no baileysMongoAuth.js é 'baileysauths' (pluralizado pelo mongoose)
        // Ou 'BaileysAuth' -> 'baileysauths'
        
        console.log('🗑️ Apagando coleção de autenticação (baileysauths)...');
        await mongoose.connection.db.dropCollection('baileysauths');
        
        console.log('✅ Sessão apagada com sucesso! O bot vai pedir QR Code no próximo reinício.');
    } catch (error) {
        if (error.code === 26) {
             console.log('ℹ️ A coleção já estava vazia ou não existia.');
        } else {
             console.error('❌ Erro ao apagar:', error);
        }
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

clearSession();
