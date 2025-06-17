const { Sequelize, DataTypes } = require("sequelize");

const sequelize = new Sequelize("ari_logs", "asterisk", "asteriskpw", {
  host: "postgres",
  dialect: "postgres",
});

const CallLog = sequelize.define("CallLog", {
  caller: DataTypes.STRING,
  callee: DataTypes.STRING,
  startTime: DataTypes.DATE,
  endTime: DataTypes.DATE,
  duration: DataTypes.INTEGER,
  recordingFile: DataTypes.STRING,
}, { timestamps: true });

async function connectWithRetry(retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      await sequelize.authenticate();
      console.log("✅ PostgreSQL connected!");
      await sequelize.sync();
      console.log("✅ Database synced!");
      return;
    } catch (err) {
      console.error(`❌ PostgreSQL connection error: ${err.message}`);
      if (i === retries - 1) process.exit(1);
      await new Promise(res => setTimeout(res, 3000));
    }
  }
}

module.exports = { CallLog, connectWithRetry };