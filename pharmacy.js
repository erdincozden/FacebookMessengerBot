'use strict';
const request = require('request');
const config = require('./config');
const pg = require('pg');
const cheerio = require('cheerio');
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
        jx: '1',
        h: '311a06933e9f31159a62e56163e584e4'
    }
};
const getToken = {
    url: 'https://www.istanbuleczaciodasi.org.tr/nobetci-eczane/#!%C4%B0stanbul/Adalar',
    method: 'GET'
};

module.exports = {
    listPharmacy: function (userId) {
        request(getToken, function (error, response, body) {
            if (!error && response.statusCode == 200) {
               // console.log(body);

               // let json = JSON.parse(body);
                //$('#h').val()

                var stringSearcher = require('string-search');
                let lastElement='';
                let key='';
                stringSearcher.find(body, 'value')
                    .then(function(resultArr) {
                        for (var x in resultArr) {
                            lastElement = x;
                        }
                        //console.log('-->'+resultArr[lastElement].text);
                        lastElement=resultArr[lastElement].text;
                        console.log('-->'+lastElement);
                        var first = lastElement.indexOf("value");
                        var last = lastElement.indexOf("/");
                        console.log(first);
                        console.log(last);
                        var res = lastElement.substring(first+7, last-1);
                        console.log(res);
                        key=res;


                        const options = {
                            url: 'https://www.istanbuleczaciodasi.org.tr/nobetci-eczane/index.php',
                            method: 'POST',
                            headers: {
                                'Accept': 'application/json'
                            },
                            form: {
                                ilce: 'Bağcılar',
                                islem: 'get_ilce_eczane',
                                jx: '1',
                                h: res
                            }
                        };

                        request(options, function (error, response, body) {
                            if (!error && response.statusCode == 200) {
                                let json = JSON.parse(body);
                                if (json.error == 0) {
                                    let lengthJson = json.eczaneler.length;
                                    console.log(json.eczaneler.length);
                                    for (let i = 0; i < lengthJson; i++) {
                                        console.log('------' + (i + 1) + '------');
                                        console.log(json.eczaneler[i].sicil);
                                        console.log(json.eczaneler[i].eczane_ad);
                                        console.log(json.eczaneler[i].eczane_tel);
                                        console.log(json.eczaneler[i].tarif);
                                        console.log(json.eczaneler[i].lat);
                                        console.log(json.eczaneler[i].lng);
                                    }
                                }else{
                                    console.error('Eczane listesi hata aldı');
                                }
                                //     console.log(json);
                            } else {
                                console.error(response.error);
                            }
                        });

                });
                console.log("SONUC:"+key);
/*
                var $ = cheerio.load(body);
                console.log('-<<<<<:'+$('#h').text());
                console.log('-<<<<<:'+$('#h').html());

                $('#h').filter(function() {
                    console.log('buldu');
                    var data = $(this);
                    console.log(data);
                    var stringSearcher = require('string-search');
                    stringSearcher.find(body, 'value')
                        .then(function(resultArr) {
                            console.log(resultArr);
                        });


                });

                console.log('next');
                $('#rr').each(function(i, element){
                    console.log('------------------');
                    var a = $(this);
                    console.log(a.text());
                });*/
                //console.log(text);
                //console.log(response);
            } else {
                console.error(response.error);
            }
        });

        request(options, function (error, response, body) {
            if (!error && response.statusCode == 200) {
                let json = JSON.parse(body);
                if (json.error == 0) {
                    let lengthJson = json.eczaneler.length;
                    console.log(json.eczaneler.length);
                    for (let i = 0; i < lengthJson; i++) {
                        console.log('------' + (i + 1) + '------');
                        console.log(json.eczaneler[i].sicil);
                        console.log(json.eczaneler[i].eczane_ad);
                        console.log(json.eczaneler[i].eczane_tel);
                        console.log(json.eczaneler[i].tarif);
                        console.log(json.eczaneler[i].lat);
                        console.log(json.eczaneler[i].lng);
                    }
                }else{
                    console.error('Eczane listesi hata aldı');
                }
                //     console.log(json);
            } else {
                console.error(response.error);
            }
        });
    }
}