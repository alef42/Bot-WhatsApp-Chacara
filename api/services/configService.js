const { db } = require('../firebase');
const fs = require('fs');
const path = require('path');

// Caminhos dos arquivos locais para migração
const BOT_CONFIG_PATH = path.join(__dirname, '../botConfig.json');
const MONITOR_CONFIG_PATH = path.join(__dirname, '../monitorConfig.json');

const configService = {
    // --- GENERAL SETTINGS ---
    async getGeneralConfig() {
        try {
            const docSnap = await db.collection('bot_settings').doc('general').get();
            if (docSnap.exists) {
                return docSnap.data();
            } else {
                console.log('⚠️ Configuração Geral não encontrada. Tentando migrar...');
                return await this.migrateGeneralConfig();
            }
        } catch (error) {
            console.error('Erro ao buscar Config Geral:', error);
            return this.readLocalJson(BOT_CONFIG_PATH); 
        }
    },

    async updateGeneralConfig(newConfig) {
        try {
            await db.collection('bot_settings').doc('general').set(newConfig, { merge: true });
            console.log('✅ Configuração Geral atualizada no Firebase.');
            return true;
        } catch (error) {
             console.error('Erro ao atualizar Config Geral:', error);
             return false;
        }
    },

    // --- MONITOR SETTINGS ---
    async getMonitorConfig() {
        try {
            const docSnap = await db.collection('bot_settings').doc('monitoring').get();
            if (docSnap.exists) {
                return docSnap.data();
            } else {
                console.log('⚠️ Configuração de Monitoramento não encontrada. Tentando migrar...');
                return await this.migrateMonitorConfig();
            }
        } catch (error) {
            console.error('Erro ao buscar Config Monitor:', error);
            return this.readLocalJson(MONITOR_CONFIG_PATH);
        }
    },

    async updateMonitorConfig(newConfig) {
        try {
            await db.collection('bot_settings').doc('monitoring').set(newConfig, { merge: true });
            console.log('✅ Configuração de Monitoramento atualizada no Firebase.');
            return true;
        } catch (error) {
             console.error('Erro ao atualizar Config Monitor:', error);
             return false;
        }
    },

    // --- MIGRATION HELPERS ---
    readLocalJson(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
        } catch (e) {
            console.error(`Erro ao ler arquivo local ${filePath}:`, e);
        }
        return null;
    },

    async migrateGeneralConfig() {
        const localData = this.readLocalJson(BOT_CONFIG_PATH);
        if (localData) {
            console.log('📤 Migrando botConfig.json para o Firebase...');
            await db.collection('bot_settings').doc('general').set(localData);
            console.log('✅ Migração Geral concluída!');
            return localData;
        }
        return { 
            systemPrompt: '', 
            testMode: true, 
            allowedNumbers: [], 
            blockedNumbers: [] 
        };
    },

    async migrateMonitorConfig() {
        const localData = this.readLocalJson(MONITOR_CONFIG_PATH);
        if (localData) {
            console.log('📤 Migrando monitorConfig.json para o Firebase...');
            await db.collection('bot_settings').doc('monitoring').set(localData);
            console.log('✅ Migração Monitoramento concluída!');
            return localData;
        }
        return { enabled: false, recipients: [], checkTime: '09:00' };
    }
};

module.exports = configService;
