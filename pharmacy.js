'use strict';
const request = require('request');
const config = require('./config');
const pg = require('pg');

pg.defaults.ssl = true;

const options = {
    url: 'https://www.istanbuleczaciodasi.org.tr/nobetci-eczane/index.php',
    method: 'POST',
    headers: {
        'Accept': 'application/json'
    },
    form: {
        ilce: 'Bağcılar',
        islem: 'get_ilce_eczane',
        jx:'1',
        h:'311a06933e9f31159a62e56163e584e4'
    }
};

module.exports = {
    listPharmacy: function (userId) {
        request(options, function (error, response, body) {
            let json = JSON.parse(body);
            console.log(json);
        });
    }
}