const { db } = require('../firebase');
const moment = require('moment');

async function checkUpcomingReservations(bufferDays = 1) {
    try {
        const snapshot = await db.collection("reservations").get();
        const today = moment().startOf('day');
        const nextWeek = moment().add(7, 'days').endOf('day');
        
        const alerts = [];

        snapshot.forEach((doc) => {
            const data = doc.data();
            if (data.status !== 'reservado') return;

            const start = moment(data.start); 
            const end = moment(data.end);

            const guestName = data.name || 'Hóspede';
            const guestPhone = data.phone || 'Sem telefone';
            const checkInTime = data.checkInTime || '08:00'; 
            const checkOutTime = data.checkOutTime || '18:00'; 

            if (today.isBetween(start, end, 'day', '[]')) {
                alerts.push({
                    type: 'active',
                    message: `📢 *Alerta de Reserva Ativa!* 🏠\n` +
                             `👤 *${guestName}*\n` +
                             `📞 ${guestPhone}\n` +
                             `------------------------------\n` +
                             `📅 *Entrada:* ${start.format('DD/MM/YYYY')} às ${checkInTime}\n` +
                             `📅 *Saída:* ${end.format('DD/MM/YYYY')} às ${checkOutTime}\n` +
                             `------------------------------`
                });
            }
            else if (start.isBetween(today, nextWeek, 'day', '(]')) {
               const daysUntil = start.diff(today, 'days');
               alerts.push({
                   type: 'upcoming',
                   message: `📅 *Próxima Reserva Chegando!* \n` +
                            `👤 *${guestName}*\n` +
                            `📞 ${guestPhone}\n` +
                            `------------------------------\n` +
                            `📥 *Check-in:* ${start.format('DD/MM/YYYY')} às ${checkInTime} (Daqui a ${daysUntil} dias)\n` +
                            `📤 *Check-out:* ${end.format('DD/MM/YYYY')} às ${checkOutTime}\n` +
                            `------------------------------`
               });
            }
        });

        return alerts;

    } catch (error) {
        console.error("Erro ao buscar reservas:", error);
        return [];
    }
}

async function checkAvailability(dateString) {
    try {
        const requestedDate = moment(dateString, 'DD/MM/YYYY');
        if (!requestedDate.isValid()) {
            return { status: 'error', message: 'Data inválida' };
        }

        const snapshot = await db.collection("reservations").get();
        let conflict = null;

        snapshot.forEach((doc) => {
            const data = doc.data();
            if (data.status !== 'reservado') return;

            const start = moment(data.start);
            const end = moment(data.end);

            if (requestedDate.isBetween(start, end, 'day', '[]')) {
                conflict = {
                    start: start.format('DD/MM/YYYY'),
                    end: end.format('DD/MM/YYYY'),
                    name: data.name || 'Outro hóspede'
                };
            }
        });

        if (conflict) {
            return { available: false, conflict };
        } else {
            return { available: true };
        }

    } catch (error) {
        console.error("Erro ao verificar disponibilidade:", error);
        return { status: 'error', message: 'Erro interno ao verificar disponibilidade.' };
    }
}

module.exports = { checkUpcomingReservations, checkAvailability };
