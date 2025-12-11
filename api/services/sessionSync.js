const mongoose = require('mongoose');
const fs = require('fs-extra');
const path = require('path');

// Schema simplificado: ID do arquivo e Conteúdo Base64
const FileSchema = new mongoose.Schema({
    _id: String, // Nome do arquivo (ex: 'creds.json')
    content: String // Base64
});

const SessionModel = mongoose.models.WhatsAppSessionFiles || mongoose.model('WhatsAppSessionFiles', FileSchema);

const LOCAL_AUTH_DIR = 'auth_info_baileys';

module.exports = {
    // 1. Restaurar: Baixa do Mongo -> Disco
    restoreSession: async () => {
        try {
            console.log('🔄 [SYNC] Verificando backup de sessão no MongoDB...');
            if (mongoose.connection.readyState !== 1) {
                console.log('⚠️ [SYNC] Sem conexão com Mongo. Pulando restore.');
                return;
            }

            const files = await SessionModel.find({});
            if (files.length === 0) {
                console.log('📂 [SYNC] Nenhuma sessão salva no banco. Iniciando limpo.');
                return;
            }

            // Garante que a pasta existe
            await fs.ensureDir(LOCAL_AUTH_DIR);

            console.log(`📥 [SYNC] Restaurando ${files.length} arquivos do banco...`);
            for (const file of files) {
                const filePath = path.join(LOCAL_AUTH_DIR, file._id);
                await fs.writeFile(filePath, file.content, 'base64');
            }
            console.log('✅ [SYNC] Sessão restaurada com sucesso!');
        } catch (e) {
            console.error('❌ [SYNC] Erro ao restaurar sessão:', e);
        }
    },

    // 2. Backup: Disco -> Mongo
    backupSession: async () => {
        try {
            if (mongoose.connection.readyState !== 1) return;

            // console.log('💾 [SYNC] Iniciando backup da sessão...'); // Debug verbose
            if (!fs.existsSync(LOCAL_AUTH_DIR)) return;

            const files = await fs.readdir(LOCAL_AUTH_DIR);
            const ops = [];

            for (const fileName of files) {
                // Ignora arquivos que nao sejam da sessao ou lockfiles
                if (fileName.startsWith('.')) continue;

                const filePath = path.join(LOCAL_AUTH_DIR, fileName);
                const content = await fs.readFile(filePath, 'base64');

                ops.push({
                    updateOne: {
                        filter: { _id: fileName },
                        update: { content: content },
                        upsert: true
                    }
                });
            }

            if (ops.length > 0) {
                await SessionModel.bulkWrite(ops);
                // console.log(`✅ [SYNC] Backup concluído (${ops.length} arquivos).`);
            }
        } catch (e) {
            console.error('❌ [SYNC] Erro no backup:', e);
        }
    }
};
