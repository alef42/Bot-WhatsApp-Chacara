const mongoose = require('mongoose');

// Schema para armazenar as credenciais da sessão (AuthState)
const AuthSchema = new mongoose.Schema({
    _id: String,   // Nome do arquivo de credencial (ex: 'creds.json', 'app-state-sync-version-...')
    data: Object   // O conteúdo JSON da credencial
});

const AuthModel = mongoose.models.BaileysAuth || mongoose.model('BaileysAuth', AuthSchema);

/**
 * Adaptador de Autenticação do Baileys para MongoDB
 * Substitui o 'useMultiFileAuthState' que salva em disco.
 */
const useMongoAuthState = async (collectionName) => {
    // collectionName pode ser usado como prefixo no ID se quisermos múltiplas sessões, 
    // mas aqui vamos simplificar usando o Model diretamente.

    const readData = async (fileName) => {
        try {
            const result = await AuthModel.findById(fileName);
            return result ? result.data : null;
        } catch (error) {
            console.error(`Erro ao ler credencial ${fileName}:`, error);
            return null;
        }
    };

    const writeData = async (data, fileName) => {
        try {
            // Upsert: atualiza se existir, cria se não
            await AuthModel.findByIdAndUpdate(
                fileName,
                { _id: fileName, data: data },
                { upsert: true, new: true }
            );
        } catch (error) {
            console.error(`Erro ao salvar credencial ${fileName}:`, error);
        }
    };

    const removeData = async (fileName) => {
        try {
            await AuthModel.findByIdAndDelete(fileName);
        } catch (error) {
            console.error(`Erro ao remover credencial ${fileName}:`, error);
        }
    };

    return {
        state: {
            creds: (await readData('creds.json')) || (await (require('@whiskeysockets/baileys').initAuthCreds)()),
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            // O Baileys pede chaves do tipo 'app-state-sync-key', etc.
                            // Vamos salvar cada uma como um documento no Mongo.
                            const value = await readData(`${type}-${id}`);
                            if (value) {
                                data[id] = value;
                            }
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
                                tasks.push(writeData(value, key));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
             // O 'state.creds' é mutável, então precisamos pegar o valor atual dele na hora de salvar
             // Mas a função saveCreds é chamada pelo Baileys quando as credenciais mudam.
             // Precisamos acessar o objeto 'creds' que retornamos no 'state'.
             // Como 'initAuthCreds' retorna um objeto novo, vamos capturar a referência dele.
        }
    };
};

// A implementação acima do saveCreds ficou incompleta pq o 'creds' precisa ser acessível.
// Vamos refazer usando a estrutura padrão da documentação do Baileys para custon stores.

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
        try { await AuthModel.findByIdAndDelete(key); } 
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
                            if (type === 'app-state-sync-key' && value) {
                                value =  require('@whiskeysockets/baileys').proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
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
            await write('creds', creds);
        }
    };
};
