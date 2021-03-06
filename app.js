'use strict';

const apiai = require('apiai');
const config = require('./config');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const request = require('request');
const app = express();
const uuid = require('uuid');
const sendgrid = require('sendgrid');
const pg = require('pg');
const userData = require('./user');
const colors = require('./colors');
const passport = require('passport')
const FacebookStrategy = require('passport-facebook').Strategy;
const session = require('express-session');
const pharmacy = require('./pharmacy');

pg.defaults.ssl = true;

// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
    throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
    throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.API_AI_CLIENT_ACCESS_TOKEN) {
    throw new Error('missing API_AI_CLIENT_ACCESS_TOKEN');
}
if (!config.FB_APP_SECRET) {
    throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
    throw new Error('missing SERVER_URL');
}
if (!config.SENDGRID_API_KEY) { //used for ink to static files
    throw new Error('missing SENDGRID_API_KEY');
}
if (!config.EMAIL_FROM) { //used for ink to static files
    throw new Error('missing EMAIL_FROM');
}
if (!config.EMAIL_TO) { //used for ink to static files
    throw new Error('missing EMAIL_TO');
}
if (!config.WEATHER_API_KEY) {
    throw new Error('missing WEATHER_API_KEY');
}
if (!config.PG_CONFIG) {
    throw new Error('missing PG_CONFIG');
}


console.log('Started');

app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
    verify: verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
    extended: false
}))

// Process application/json
app.use(bodyParser.json())

app.use(session({
    secret: 'keyboard cat',
    resave: true,
    saveUninitilized: true
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser(function (profile, cb) {
    cb(null, profile);
});

passport.deserializeUser(function (profile, cb) {
    cb(null, profile);
});

app.set('view engine', 'ejs');

app.get('/auth/facebook', passport.authenticate('facebook', {scope: 'public_profile'}));


app.get('/auth/facebook/callback',
    passport.authenticate('facebook', {
        successRedirect: '/broadcast',
        failureRedirect: '/'
    }));


passport.use(new FacebookStrategy({
        clientID: config.FB_APP_ID,
        clientSecret: config.FB_APP_SECRET,
        callbackURL: config.SERVER_URL + "auth/facebook/callback"
    },
    function (accessToken, refreshToken, profile, cb) {
        process.nextTick(function () {
            return cb(null, profile);
        });
    }
));


const apiAiService = apiai(config.API_AI_CLIENT_ACCESS_TOKEN, {
    language: "en",
    requestSource: "fb"
});
const sessionIds = new Map();
const usersMap = new Map();

// Index route
app.get('/', function (req, res) {
    pharmacy.listPharmacy(1);
    res.render('login');
});
app.get('/no-access', function (req, res) {
    res.render('no-access');
});
app.get('/broadcast', ensureAuthenticated, function (req, res) {
    res.render('broadcast', {user: req.user});
});
app.post('/broadcast', ensureAuthenticated, function (req, res) {
    let message = req.body.message;
    let newstype = parseInt(req.body.newstype, 10);
    req.session.newstype = newstype;
    req.session.message = message;

    userData.readAllUsers(function (users) {
        req.session.users = users;
        console.log("Message:" + message);
        console.log("users:" + users);
        console.log("numUsers:" + users.length);
        res.render('broadcast-confirm', {
            user: req.user,
            message: message,
            users: users,
            numUsers: users.length,
            newstype: newstype
        });

    }, newstype);

    //res.render('broadcast-confirm');
});
app.get('/broadcast-send', ensureAuthenticated, function (req, res) {
    let message = req.session.message;
    let users = req.session.users;
    let sender;
    console.log("message_send:" + message);
    for (let i = 0; i < users.length; i++) {
        sender = users[i].fb_id;
        sendTextMessage(sender, message);
    }
    res.redirect('broadcast-send');
});
app.get('/broadcast-send', ensureAuthenticated, function (req, res) {
    let newstype = req.session.newstype;
    let message = req.session.message;
    let users = req.session.users;
    req.session.newstype = null;
    req.session.message = null;
    req.session.users = null;
    res.render('broadcast-send', {message: message, users: users, numUsers: users.length, newstype: newstype});
});
app.get('/logout', ensureAuthenticated, function (req, res) {
    req.logOut();
    res.redirect('/');
});


function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        if (req.user.id === '1928042127238497') {
            return next();
        }
        res.redirect('/no-access');
    } else {
        res.redirect('/');
    }
}

// for Facebook verification
app.get('/webhook/', function (req, res) {
    console.log("request");
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        console.error("Failed validation. Make sure the validation tokens match.");
        res.sendStatus(403);
    }
});

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook/', function (req, res) {
    var data = req.body;
    console.log(JSON.stringify(data));


    // Make sure this is a page subscription
    if (data.object == 'page') {
        // Iterate over each entry
        // There may be multiple if batched
        data.entry.forEach(function (pageEntry) {
            var pageID = pageEntry.id;
            var timeOfEvent = pageEntry.time;

            // Iterate over each messaging event
            pageEntry.messaging.forEach(function (messagingEvent) {
                if (messagingEvent.optin) {
                    receivedAuthentication(messagingEvent);
                } else if (messagingEvent.message) {
                    receivedMessage(messagingEvent);
                } else if (messagingEvent.delivery) {
                    receivedDeliveryConfirmation(messagingEvent);
                } else if (messagingEvent.postback) {
                    receivedPostback(messagingEvent);
                } else if (messagingEvent.read) {
                    receivedMessageRead(messagingEvent);
                } else if (messagingEvent.account_linking) {
                    receivedAccountLink(messagingEvent);
                } else {
                    console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                }
            });
        });

        // Assume all went well.
        // You must send back a 200, within 20 seconds
        res.sendStatus(200);
    }
});

function setSessionUser(senderID) {

    if (!sessionIds.has(senderID)) {
        sessionIds.set(senderID, uuid.v1());
    }
    if (!usersMap.has(senderID)) {
        userData.addUser(function (user) {
            usersMap.set(senderID, user);
        }, senderID);
    } else {
        userData.addUser(function (user) {
            usersMap.set(senderID, user);
        }, senderID);
    }
}

function receivedMessage(event) {

    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp;
    var message = event.message;

    setSessionUser(senderID);
    console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
    console.log(JSON.stringify(message));

    var isEcho = message.is_echo;
    var messageId = message.mid;
    var appId = message.app_id;
    var metadata = message.metadata;

    // You may get a text or attachment but not both
    var messageText = message.text;
    var messageAttachments = message.attachments;
    var quickReply = message.quick_reply;

    if (isEcho) {
        handleEcho(messageId, appId, metadata);
        return;
    } else if (quickReply) {
        handleQuickReply(senderID, quickReply, messageId);
        return;
    }


    if (messageText) {
        //send message to api.ai
        sendToApiAi(senderID, messageText);
    } else if (messageAttachments) {
        handleMessageAttachments(messageAttachments, senderID);
    }
}


function handleMessageAttachments(messageAttachments, senderID) {
    //for now just reply
    sendTextMessage(senderID, "Attachment received. Thank you.");
}

function handleQuickReply(senderID, quickReply, messageId) {
    var quickReplyPayload = quickReply.payload;
    switch (quickReplyPayload) {
        case 'NEWS_PER_WEEK':
            userData.newsletterSettings(function (updated) {
                if (updated) {
                    sendTextMessage(senderID, "Per week is successfull record.'unsubscribe from newsletter'");
                } else {
                    sendTextMessage(senderID, "Unavailable. Try later.");
                }
            }, 1, senderID);
            break;
        case 'NEWS_PER_DAY':
            userData.newsletterSettings(function (updated) {
                if (updated) {
                    sendTextMessage(senderID, "Per week is successfull record.'unsubscribe from newsletter'");
                } else {
                    sendTextMessage(senderID, "Unavailable. Try later.");
                }
            }, 2, senderID);
            break;
    }
    console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);
    //send payload to api.ai
    sendToApiAi(senderID, quickReplyPayload);
}

//https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-echo
function handleEcho(messageId, appId, metadata) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
}

function handleApiAiAction(sender, action, responseText, contexts, parameters) {
    console.log("Action:::" + action);
    switch (action) {
        case "unsubscribe":
            userData.newsletterSettings(function (updated) {
                if (updated) {
                    sendTextMessage(sender, "unsubscribe succesfull.");
                } else {
                    sendTextMessage(sender, "Unavailable. Try later.");
                }
            }, 0, sender);
            break;
        case "buy.iphone8":

            /*
            colors.readUserColor(function (color) {
                let reply;
                if (color === '') {
                    reply = `What color you want to?`;
                } else {
                    reply = `Would you like ${color} ?`;
                }
                sendTextMessage(sender, reply);
            }, sender);*/
            sendGenericMessage(sender, '');
            break;
        case "iphone8_colors.favorite":
            colors.updateUserColor(parameters['color'], sender);
            let reply = `Ok. I will remember it`;
            sendTextMessage(sender, reply);
            break;
        case "iphone-colors":
            colors.readAllColors(function (allColors) {
                let allColorsString = allColors.join(', ');
                let reply = `Iphone available : ${allColorsString}.What is your favorite color?`;
                sendTextMessage(sender, reply);

            });
            break;
        case "get-current-weather":
            if (parameters.hasOwnProperty("geo-city") && parameters["geo-city"] != '') {
                var request = require('request');
                request({
                    url: 'http://api.openweathermap.org/data/2.5/weather',
                    qs: {
                        appid: config.WEATHER_API_KEY,
                        q: parameters["geo-city"],
                        units: 'metric',
                        lang: 'tr'
                    },
                }, function (error, response, body) {
                    if (!error && response.statusCode == 200) {
                        let weather = JSON.parse(body);
                        if (weather.hasOwnProperty("weather")) {
                            let reply = `${responseText} ${weather["weather"][0]["description"]}`+
                               ` `+`${weather["main"]["temp"]} derece.`;
                            console.log(weather["main"]["temp"]);
                            sendTextMessage(sender, reply);
                        } else {
                            sendTextMessage(sender, `No weather forecast available for ${parameters["geo-city"]}`);
                        }
                    } else {
                        console.log(response.error);
                    }
                });
            } else {
                sendTextMessage(sender, responseText);
            }
            break;
        case "faq-delivery":
            sendTextMessage(sender, responseText);
            sendTypingOn(sender);
            setTimeout(function () {
                let buttons = [
                    {
                        type: "web_url",
                        url: "https://www.messenger.com",
                        title: "Visit Messenger"
                    },
                    {
                        type: "phone_number",
                        title: "Call Us",
                        payload: "+1(212)555-2368"
                    },
                    {
                        type: "postback",
                        title: "Call Us",
                        payload: "CHAT"
                    }
                ];
                sendButtonMessage(sender, "What would do you next?", buttons)
            });
            break;
        case "detailed-application":
            console.log('context:' + JSON.stringify(contexts));

            if (isDefined(contexts[0]) && (contexts[0].name == 'job_application'
                    || contexts[0].name == 'job-application-details_dialog_context') && contexts[0].parameters) {
                let phone_number = (isDefined(contexts[0].parameters['phone-number']) && contexts[0].parameters['phone-number'] != '')
                    ? contexts[0].parameters['phone-number'] : '';
                let user_name = (isDefined(contexts[0].parameters['user-name']) && contexts[0].parameters['user-name'] != '')
                    ? contexts[0].parameters['user-name'] : '';
                let previous_job = (isDefined(contexts[0].parameters['pre-job']) && contexts[0].parameters['pre-job'] != '')
                    ? contexts[0].parameters['pre-job'] : '';
                let years_of_experience = (isDefined(contexts[0].parameters['years-experience'])
                    && contexts[0].parameters['years-experience'] != '') ? contexts[0].parameters['years-experience'] : '';
                let job_vacancy = (isDefined(contexts[0].parameters['jobs-vacony']) && contexts[0].parameters['jobs-vacony'] != '')
                    ? contexts[0].parameters['jobs-vacony'] : '';

                console.log('phone_number...' + phone_number);
                console.log('user_name...' + user_name);
                console.log('previous_job...' + previous_job);
                console.log('years_of_experience...' + years_of_experience);
                console.log('job_vacancy...' + job_vacancy);

                if (phone_number == '' && user_name != '' && previous_job != '' && years_of_experience == '') {

                    let replies = [
                        {
                            "content_type": "text",
                            "title": "Less than 1 year",
                            "payload": "Less than 1 year"
                        },
                        {
                            "content_type": "text",
                            "title": "Less than 10 years",
                            "payload": "Less than 10 years"
                        },
                        {
                            "content_type": "text",
                            "title": "More than 10 years",
                            "payload": "More than 10 years"
                        }
                    ];
                    console.log(replies);
                    sendQuickReply(sender, responseText, replies);

                } else if (phone_number != '' && user_name != '' && previous_job != '' && years_of_experience != '' && job_vacancy != '') {
                    let emailContent = 'A new job from ' + user_name + ' for the job:' + job_vacancy + ' Previous job ' +
                        previous_job + '.<br>  Phone number:' + phone_number;
                    console.log('SEND MAIL...' + emailContent);
                    sendEmail('New Job Application', emailContent);
                    sendTextMessage(sender, responseText);
                } else {
                    sendTextMessage(sender, responseText);
                }
            }
            break;
        case "job-enquiry":
            let replies = [
                {
                    "content_type": "text",
                    "title": "Accountant",
                    "payload": "Accountant"
                },
                {
                    "content_type": "text",
                    "title": "Sale Person",
                    "payload": "Sale Person"
                },
                {
                    "content_type": "text",
                    "title": "Not Interested",
                    "payload": "Not Interested"
                },
                {
                    "content_type": "location"
                }
            ];
            console.log(replies);
            sendQuickReply(sender, responseText, replies);
            break;
        default:
            //unhandled action, just send back the text
            sendTextMessage(sender, responseText);
    }
}

function sendEmail(subject, content) {

    const sgMail = require('@sendgrid/mail')
    sgMail.setApiKey(config.SENDGRID_API_KEY);
    const msg = {
        to: config.EMAIL_TO,
        from: config.EMAIL_FROM,
        subject: subject,
        text: 'and easy to do anywhere, even with Node.js',
        html: content,
    };
    sgMail.send(msg);
}

function handleMessage(message, sender) {
    switch (message.type) {
        case 0: //text
            sendTextMessage(sender, message.speech);
            break;
        case 2: //quick replies
            let replies = [];
            for (var b = 0; b < message.replies.length; b++) {
                let reply =
                    {
                        "content_type": "text",
                        "title": message.replies[b],
                        "payload": message.replies[b]
                    }
                replies.push(reply);
            }
            sendQuickReply(sender, message.title, replies);
            break;
        case 3: //image
            sendImageMessage(sender, message.imageUrl);
            break;
        case 4:
            // custom payload
            var messageData = {
                recipient: {
                    id: sender
                },
                message: message.payload.facebook

            };

            callSendAPI(messageData);

            break;
    }
}


function handleCardMessages(messages, sender) {

    let elements = [];
    for (var m = 0; m < messages.length; m++) {
        let message = messages[m];
        let buttons = [];
        for (var b = 0; b < message.buttons.length; b++) {
            let isLink = (message.buttons[b].postback.substring(0, 4) === 'http');
            let button;
            if (isLink) {
                button = {
                    "type": "web_url",
                    "title": message.buttons[b].text,
                    "url": message.buttons[b].postback
                }
            } else {
                button = {
                    "type": "postback",
                    "title": message.buttons[b].text,
                    "payload": message.buttons[b].postback
                }
            }
            buttons.push(button);
        }


        let element = {
            "title": message.title,
            "image_url": message.imageUrl,
            "subtitle": message.subtitle,
            "buttons": buttons
        };
        elements.push(element);
    }
    sendGenericMessage(sender, elements);
}


function handleApiAiResponse(sender, response) {
    let responseText = response.result.fulfillment.speech;
    let responseData = response.result.fulfillment.data;
    let messages = response.result.fulfillment.messages;
    let action = response.result.action;
    let contexts = response.result.contexts;
    let parameters = response.result.parameters;

    sendTypingOff(sender);
    console.log('responseText:' + responseText);
    console.log('responseData:' + responseData);
    console.log('messages:' + JSON.stringify(messages));
    console.log('action:' + action);
    console.log('contexts:' + JSON.stringify(contexts));
    console.log('parameters:' + JSON.stringify(parameters));
    /*
	if (isDefined(messages) && (messages.length == 1 && messages[0].type != 0 || messages.length > 1)) {
		let timeoutInterval = 1100;
		let previousType ;
		let cardTypes = [];
		let timeout = 0;


		for (var i = 0; i < messages.length; i++) {

			if ( previousType == 1 && (messages[i].type != 1 || i == messages.length - 1)) {

				timeout = (i - 1) * timeoutInterval;
				setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
				cardTypes = [];
				timeout = i * timeoutInterval;
				setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
			} else if ( messages[i].type == 1 && i == messages.length - 1) {
				cardTypes.push(messages[i]);
                		timeout = (i - 1) * timeoutInterval;
                		setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
                		cardTypes = [];
			} else if ( messages[i].type == 1 ) {
				cardTypes.push(messages[i]);
			} else {
				timeout = i * timeoutInterval;
				setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
			}

			previousType = messages[i].type;

		}
	} else*/
    if (responseText == '' && !isDefined(action)) {
        //api ai could not evaluate input.
        console.log('Unknown query' + response.result.resolvedQuery);
        sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
    } else if (isDefined(action)) {
        console.log('Known query');
        handleApiAiAction(sender, action, responseText, contexts, parameters);
    } else if (isDefined(responseData) && isDefined(responseData.facebook)) {
        try {
            console.log('Response as formatted message' + responseData.facebook);
            sendTextMessage(sender, responseData.facebook);
        } catch (err) {
            sendTextMessage(sender, err.message);
        }
    } else if (isDefined(responseText)) {

        sendTextMessage(sender, responseText);
    }
}

function sendToApiAi(sender, text) {
    console.log("Sending api.ai:" + text);
    sendTypingOn(sender);
    let apiaiRequest = apiAiService.textRequest(text, {
        sessionId: sessionIds.get(sender)
    });

    apiaiRequest.on('response', (response) => {
        if (isDefined(response.result)) {
            handleApiAiResponse(sender, response);
        }
    });

    apiaiRequest.on('error', (error) => console.error(error));
    apiaiRequest.end();
}


function sendTextMessage(recipientId, text) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text
        }
    }
    callSendAPI(messageData);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId, imageUrl) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: imageUrl
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: config.SERVER_URL + "/assets/instagram_logo.gif"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "audio",
                payload: {
                    url: config.SERVER_URL + "/assets/sample.mp3"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example videoName: "/assets/allofus480.mov"
 */
function sendVideoMessage(recipientId, videoName) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "video",
                payload: {
                    url: config.SERVER_URL + videoName
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example fileName: fileName"/assets/test.txt"
 */
function sendFileMessage(recipientId, fileName) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "file",
                payload: {
                    url: config.SERVER_URL + fileName
                }
            }
        }
    };

    callSendAPI(messageData);
}


/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId, text, buttons) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: text,
                    buttons: buttons
                }
            }
        }
    };

    callSendAPI(messageData);
}


function sendGenericMessage(recipientId, elements) {
    let replies = [
        {
            "title": "Welcome!",
            "subtitle": "We have the right hat for everyone.",
            "default_action": {
                "type": "web_url",
                "url": "http://www.milliyet.com.tr/",
                "messenger_extensions": false,
                "webview_height_ratio": "tall",
                "fallback_url": "http://www.milliyet.com.tr/"
            },
            "buttons": [
                {
                    "type": "web_url",
                    "url": "http://www.milliyet.com.tr/",
                    "title": "View Website"
                }, {
                    "type": "postback",
                    "title": "Start Chatting",
                    "payload": "DEVELOPER_DEFINED_PAYLOAD"
                }
            ]
        }];
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "generic",
                    elements: replies
                }
            }
        }
    };

    callSendAPI(messageData);
}


function sendReceiptMessage(recipientId, recipient_name, currency, payment_method,
                            timestamp, elements, address, summary, adjustments) {
    // Generate a random receipt ID as the API requires a unique ID
    var receiptId = "order" + Math.floor(Math.random() * 1000);

    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "receipt",
                    recipient_name: recipient_name,
                    order_number: receiptId,
                    currency: currency,
                    payment_method: payment_method,
                    timestamp: timestamp,
                    elements: elements,
                    address: address,
                    summary: summary,
                    adjustments: adjustments
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId, text, replies, metadata) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text,
            metadata: isDefined(metadata) ? metadata : '',
            quick_replies: replies
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {

    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "mark_seen"
    };

    callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {


    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_on"
    };

    callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {


    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_off"
    };

    callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Welcome. Link your account.",
                    buttons: [{
                        type: "account_link",
                        url: config.SERVER_URL + "/authorize"
                    }]
                }
            }
        }
    };

    callSendAPI(messageData);
}


function greetUserText(userId) {

    let user = usersMap.get(userId);
    console.log("GreetUSER:" + user);
    sendTextMessage(userId, "Welcome " + user.first_name + '!' + user.gender + ' How I can help you?');

}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {
    console.log('contexts:' + JSON.stringify(messageData));
    request({
        uri: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {
            access_token: config.FB_PAGE_TOKEN
        },
        method: 'POST',
        json: messageData

    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var recipientId = body.recipient_id;
            var messageId = body.message_id;

            if (messageId) {
                console.log("Successfully sent message with id %s to recipient %s",
                    messageId, recipientId);
            } else {
                console.log("Successfully called Send API for recipient %s",
                    recipientId);
            }
        } else {
            console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
        }
    });
}

function sendFunNewsSubsribe(userId) {
    let responseText = `I can send you some news? How often you want?`;
    let replies = [
        {
            "content_type": "text",
            "title": "One day",
            "payload": "NEWS_PER_DAY"
        },
        {
            "content_type": "text",
            "title": "One week",
            "payload": "NEWS_PER_WEEK"
        }
    ];

    sendQuickReply(userId, responseText, replies);
}

/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message. 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 * 
 */
function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;

    // The 'payload' param is a developer-defined field which is set in a postback
    // button for Structured Messages.
    setSessionUser(senderID);
    var payload = event.postback.payload;

    switch (payload) {
        case 'FUN_NEWS':
            sendFunNewsSubsribe(senderID);
            break;
        case 'GET_STARTED':
            greetUserText(senderID);
            break;
        case 'CHAT':
            sendTextMessage(senderID, "I love chatting. Have any questions?");
            break;
        default:
            //unindentified payload
            sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
            break;

    }

    console.log("Received postback for user %d and page %d with payload '%s' " +
        "at %d", senderID, recipientID, payload, timeOfPostback);

}


/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 * 
 */
function receivedMessageRead(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    // All messages before watermark (a timestamp) or sequence have been seen.
    var watermark = event.read.watermark;
    var sequenceNumber = event.read.seq;

    console.log("Received message read event for watermark %d and sequence " +
        "number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 * 
 */
function receivedAccountLink(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    var status = event.account_linking.status;
    var authCode = event.account_linking.authorization_code;

    console.log("Received account link event with for user %d with status %s " +
        "and auth code %s ", senderID, status, authCode);
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about 
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var delivery = event.delivery;
    var messageIDs = delivery.mids;
    var watermark = delivery.watermark;
    var sequenceNumber = delivery.seq;

    if (messageIDs) {
        messageIDs.forEach(function (messageID) {
            console.log("Received delivery confirmation for message ID: %s",
                messageID);
        });
    }

    console.log("All message before %d were delivered.", watermark);
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to 
 * Messenger" plugin, it is the 'data-ref' field. Read more at 
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfAuth = event.timestamp;

    // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
    // The developer can set this to an arbitrary value to associate the
    // authentication callback with the 'Send to Messenger' click event. This is
    // a way to do account linking when the user clicks the 'Send to Messenger'
    // plugin.
    var passThroughParam = event.optin.ref;

    console.log("Received authentication for user %d and page %d with pass " +
        "through param '%s' at %d", senderID, recipientID, passThroughParam,
        timeOfAuth);

    // When an authentication is received, we'll send a message back to the sender
    // to let them know it was successful.
    sendTextMessage(senderID, "Authentication successful");
}

/*
 * Verify that the callback came from Facebook. Using the App Secret from 
 * the App Dashboard, we can verify the signature that is sent with each 
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
    var signature = req.headers["x-hub-signature"];

    if (!signature) {
        throw new Error('Couldn\'t validate the signature.');
    } else {
        var elements = signature.split('=');
        var method = elements[0];
        var signatureHash = elements[1];

        var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
            .update(buf)
            .digest('hex');

        if (signatureHash != expectedHash) {
            throw new Error("Couldn't validate the request signature.");
        }
    }
}

function isDefined(obj) {
    if (typeof obj == 'undefined') {
        return false;
    }

    if (!obj) {
        return false;
    }

    return obj != null;
}

// Spin up the server
app.listen(app.get('port'), function () {
    console.log('running on port', app.get('port'))
})
