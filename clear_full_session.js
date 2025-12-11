require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs-extra');

const uri = process.env.MONGO_URI;

// Schemas para limpar
const AuthSchema = new mongoose.Schema({_id: String, data: Object});
const FileSchema = new mongoose.Schema({_id: String, content: String});

const AuthModel = mongoose.models.WhatsAppSession || mongoose.model('WhatsAppSession', AuthSchema);
const SessionModel = mongoose.models.WhatsAppSessionFiles || mongoose.model('WhatsAppSessionFiles', FileSchema);

async function clearAll() {
    try {
        console.log("⏳ Conectando...");
        await mongoose.connect(uri);
        
        console.log("🗑️ (Mongo) Limpando coleções antigas...");
        await AuthModel.deleteMany({});
        await SessionModel.deleteMany({});
        
        console.log("🗑️ (Disk) Limpando pasta local...");
        await fs.remove('auth_info_baileys');
        await fs.remove('auth_info_v2'); 
        await fs.remove('auth_info_final'); 
        await fs.remove('auth_info_qr_final'); // A pasta REALMENTE atual!

        console.log("✅ TUDO LIMPO! Pode testar do zero.");
        process.exit(0);
    } catch (error) {
        console.error("Erro:", error);
        process.exit(1);
    }
}

clearAll();
