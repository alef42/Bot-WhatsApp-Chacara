const { db } = require('../firebase');
const { collection, getDocs, query, where, orderBy } = require('firebase/firestore');
const moment = require('moment'); // Já está instalado

async function checkUpcomingReservations(bufferDays = 1) {
    try {
        const reservationsRef = collection(db, "reservations");
        // Busca todas as reservas (idealmente filtraríamos no Firebase, mas por string de data é chato)
        // Vamos pegar tudo e filtrar no código por enquanto (se tiver muita reserva, melhorar query)
        const q = query(reservationsRef); 
        const querySnapshot = await getDocs(q);
        
        const today = moment().startOf('day');
        const nextWeek = moment().add(7, 'days').endOf('day');
        
        const alerts = [];

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            // Data do Firestore pode vir como String (YYYY-MM-DD) ou timestamp
            // No utils.ts vi que salva como string ISO na maioria das vezes, mas aqui vamos garantir
           
            if (data.status !== 'reservado') return;

            const start = moment(data.start); // data.start deve ser YYYY-MM-DD
            const end = moment(data.end);

            // Field names based on AdminReservations.tsx
            const guestName = data.name || 'Hóspede';
            const guestPhone = data.phone || 'Sem telefone';
            const totalValue = data.totalValue ? Number(data.totalValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'R$ 0,00';
            const checkInTime = data.checkInTime || '08:00'; // Fallback se não salvo
            const checkOutTime = data.checkOutTime || '18:00'; 

            // Regra: "Avisar todos os dias da reserva" E "Se tiver agendada"
            // Interpretação: Avisar se HOJE é dia de reserva
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
            // Regra: Avisar se começa EM BREVE (ex: amanhã ou depois)
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
        // dateString espera formato DD/MM/YYYY
        const requestedDate = moment(dateString, 'DD/MM/YYYY');
        if (!requestedDate.isValid()) {
            return { status: 'error', message: 'Data inválida' };
        }

        const reservationsRef = collection(db, "reservations");
        const q = query(reservationsRef); // Pega tudo e filtra em memória (igual ao checkUpcoming)
        const querySnapshot = await getDocs(q);

        let conflict = null;

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.status !== 'reservado') return;

            const start = moment(data.start);
            const end = moment(data.end);

            // Verifica se a data solicitada cai DENTRO de uma reserva existente
            // Usamos '[]' para inclusivo (se cair no dia de entrada ou saída, considera ocupado para garantir)
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
