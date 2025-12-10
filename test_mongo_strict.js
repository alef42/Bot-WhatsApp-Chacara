const mongoose = require('mongoose');

const uri = "mongodb+srv://alefsantos4255_db_user:JoVNwgweibGd5aXy@cluster0.2zms3ia.mongodb.net/?appName=Cluster0";

// Append database name if missing to see if that helps, or test as is.
// Testing AS IS first to see if it fails.
console.log(`Tentando conectar com URI: ${uri}`);

async function testConnection() {
    try {
        await mongoose.connect(uri);
        console.log("✅ Conexão bem sucedida!");
        console.log(`Database Name: ${mongoose.connection.db.databaseName}`);
        
        // Tentar escrever algo simples para testar permissão
        const TestSchema = new mongoose.Schema({ test: String });
        const TestModel = mongoose.model('ConnectionTest', TestSchema);
        await TestModel.create({ test: 'Hello Mongo' });
        console.log("✅ Gravacao bem sucedida!");

        process.exit(0);
    } catch (error) {
        console.error("❌ Falha na conexão:");
        console.error(error);
        process.exit(1);
    }
}

testConnection();
