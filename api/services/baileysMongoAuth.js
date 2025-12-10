const mongoose = require('mongoose');

// Schema para armazenar as credenciais da sessão (AuthState)
const AuthSchema = new mongoose.Schema({
    _id: String,   // Nome do arquivo de credencial (ex: 'creds.json', 'app-state-sync-version-...')
    data: Object   // O conteúdo JSON da credencial
});

const AuthModel = mongoose.models.BaileysAuth || mongoose.model('BaileysAuth', AuthSchema);

module.exports = async () => {
    const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
    
    // Funções auxiliares tipadas implicitamente
    const read = async (key) => {
        try {
            const res = await AuthModel.findById(key);
            if (res && res.data) {
                // BufferJSON.reviver ajuda a restaurar Buffers que foram viraram string no JSON
                return JSON.parse(JSON.stringify(res.data), BufferJSON.reviver);
            }
        } catch (e) {
             console.error('Mongo Read Error:', e);
        }
        return null;
    };

    const write = async (key, data) => {
        try {
            // console.log(`💾 Saving auth data: ${key}`); // Verbose debug
            await AuthModel.findByIdAndUpdate(
                key, 
                { _id: key, data: JSON.parse(JSON.stringify(data, BufferJSON.replacer)) },
                { upsert: true }
            );
        } catch(e) {
            console.error('Mongo Write Error:', e);
        }
    };
    
    const remove = async (key) => {
        try { 
            console.log(`🗑️ Removing auth data: ${key}`);
            await AuthModel.findByIdAndDelete(key); 
        } 
        catch(e) { console.error('Mongo Remove Error:', e); }
    };

    const creds = (await read('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await read(`${type}-${id}`);
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                tasks.push(write(key, value));
                            } else {
                                tasks.push(remove(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            console.log('💾 Saving CREDS (Critical)...');
            await write('creds', creds);
        }
    };
};
