const { db } = require('../firebase');
const fs = require('fs');
const path = require('path');

const SCHEDULES_FILE_PATH = path.join(__dirname, '../schedules.json');
const COLLECTION_NAME = 'bot_schedules';

const scheduleService = {
    async getAllSchedules() {
        try {
            const snapshot = await db.collection(COLLECTION_NAME).get();
            const schedules = [];
            
            if (snapshot.empty) {
                return await this.checkAndMigrate();
            }

            snapshot.forEach((doc) => {
                schedules.push({ id: doc.id, ...doc.data() });
            });
            return schedules;

        } catch (error) {
            console.error('Erro ao buscar agendamentos:', error);
            return this.readLocalJson();
        }
    },

    async addSchedule(scheduleData) {
        try {
            const docRef = await db.collection(COLLECTION_NAME).add(scheduleData);
            return { id: docRef.id, ...scheduleData };
        } catch (error) {
            console.error('Erro ao adicionar agendamento:', error);
            throw error;
        }
    },

    async deleteSchedule(id) {
        try {
            await db.collection(COLLECTION_NAME).doc(id).delete();
            return true;
        } catch (error) {
            console.error('Erro ao deletar agendamento:', error);
            throw error;
        }
    },

    // --- MIGRATION ---
    readLocalJson() {
        try {
            if (fs.existsSync(SCHEDULES_FILE_PATH)) {
                return JSON.parse(fs.readFileSync(SCHEDULES_FILE_PATH, 'utf8'));
            }
        } catch (e) {
            console.error('Erro ao ler schedules.json:', e);
        }
        return [];
    },

    async checkAndMigrate() {
        console.log('🔍 Verificando migração de agendamentos...');
        const localData = this.readLocalJson();
        
        if (localData && localData.length > 0) {
            console.log(`📤 Migrando ${localData.length} agendamentos para o Firebase...`);
            const verifiedSchedules = [];

            for (const item of localData) {
                const { id, ...data } = item;
                const newDoc = await this.addSchedule(data);
                verifiedSchedules.push(newDoc);
            }
            console.log('✅ Migração de agendamentos concluída.');
            return verifiedSchedules;
        }
        
        return []; 
    }
};

module.exports = scheduleService;
