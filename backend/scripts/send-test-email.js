require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { sendOverdueReminder } = require('../services/mailer');

const member = {
  name: 'Carlos Mendoza',
  email: 'your@email.com',
  nextDueDate: new Date(Date.now() - 5 * 86400000), // 5 days overdue
};

const store = {
  businessName: 'Iron Gym 3Speak',
  hiveAccount: 'irongym',
};

sendOverdueReminder(member, store)
  .then(() => console.log('Test email sent to', member.email))
  .catch(err => { console.error('Failed:', err.message); process.exit(1); });
