const {join} = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Configura o Puppeteer para baixar o Chrome dentro do repositório
  // Isso evita problemas em ambientes de hospedagem como Render e Heroku
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
