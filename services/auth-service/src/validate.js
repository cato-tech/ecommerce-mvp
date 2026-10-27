const { BadRequest } = require('@ecommerce/common');

function validateRegister({ username, password, email, phone }) {
  if (!username || !password || !email) {
    throw BadRequest('username, password and email are required');
  }
  if (!/^[A-Za-z0-9_.]{3,50}$/.test(username)) {
    throw BadRequest('username must be 3-50 chars: letters, digits, _ or .');
  }
  if (password.length < 6 || password.length > 72) {
    // bcrypt chỉ xét tối đa 72 byte đầu
    throw BadRequest('password must be 6-72 characters');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
    throw BadRequest('invalid email');
  }
  if (phone && !/^[0-9+]{9,15}$/.test(phone)) {
    throw BadRequest('invalid phone');
  }
}

module.exports = { validateRegister };
