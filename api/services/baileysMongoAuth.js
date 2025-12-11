const mongoose = require('mongoose');

// Schema para armazenar as credenciais
const AuthSchema = new mongoose.Schema({
    _id: String,
    data: Object
});

// Usando um nome de colection novo para garantir que não haja sujeira antiga
const AuthModel = mongoose.models.WhatsAppSession || mongoose.model('WhatsAppSession', AuthSchema);

// Helper para converter Buffers em String Base64 recursivamente
const bufferToBase64 = (obj) => {
    if (Buffer.isBuffer(obj)) return { type: 'Buffer', data: obj.toString('base64') };
    if (Array.isArray(obj)) return obj.map(bufferToBase64);
    if (obj && typeof obj === 'object') {
        const newObj = {};
        for (const key in obj) {
            newObj[key] = bufferToBase64(obj[key]);
        }
        return newObj;
    }
    return obj;
};

// Helper para converter String Base64 de volta para Buffer recursivamente
const base64ToBuffer = (obj) => {
    if (obj && typeof obj === 'object' && obj.type === 'Buffer' && typeof obj.data === 'string') {
        return Buffer.from(obj.data, 'base64');
    }
    if (Array.isArray(obj)) return obj.map(base64ToBuffer);
    if (obj && typeof obj === 'object') {
        const newObj = {};
        for (const key in obj) {
            newObj[key] = base64ToBuffer(obj[key]);
        }
        return newObj;
    }
    return obj;
};

module.exports = async () => {
    const { initAuthCreds } = require('@whiskeysockets/baileys');
    
    const read = async (key) => {
        try {
            const res = await AuthModel.findById(key);
            if (res && res.data) {
                return base64ToBuffer(res.data);
            }
        } catch (e) {
             console.error('Mongo Read Error:', e);
        }
        return null;
    };

    const write = async (key, data) => {
        try { // Single write fallback
             await AuthModel.findByIdAndUpdate(
                key, 
                { _id: key, data: bufferToBase64(data) },
                { upsert: true }
             );
        } catch(e) { console.error('Mongo Write Error:', e); }
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
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const ops = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) {
                                ops.push({
                                    updateOne: {
                                        filter: { _id: key },
                                        update: { data: bufferToBase64(value) },
                                        upsert: true
                                    }
                                });
                            } else {
                                ops.push({
                                    deleteOne: {
                                        filter: { _id: key }
                                    }
                                });
                            }
                        }
                    }
                    
                    if (ops.length > 0) {
                        try {
                            await AuthModel.bulkWrite(ops);
                        } catch (e) {
                            console.error('Mongo BulkWrite Error:', e);
                        }
                    }
                }
            }
        },
        saveCreds: async () => {
             // Debug para garantir que está salvando
            // console.log('💾 Saving CREDS...'); 
            await write('creds', creds);
        }
    };
};
