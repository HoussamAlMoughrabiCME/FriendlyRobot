/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */
'use strict';

const
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),
  request = require('request');

var app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));

/*
 * Be sure to setup your config values before running this code. You can
 * set them using environment variables or modifying the config file in /config.
 *
 */

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = (process.env.MESSENGER_APP_SECRET) ?
  process.env.MESSENGER_APP_SECRET :
  config.get('appSecret');

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = (process.env.MESSENGER_VALIDATION_TOKEN) ?
  (process.env.MESSENGER_VALIDATION_TOKEN) :
  config.get('validationToken');

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = (process.env.MESSENGER_PAGE_ACCESS_TOKEN) ?
  (process.env.MESSENGER_PAGE_ACCESS_TOKEN) :
  config.get('pageAccessToken');

// URL where the app is running (include protocol). Used to point to scripts and
// assets located at this address.
const SERVER_URL = (process.env.SERVER_URL) ?
  (process.env.SERVER_URL) :
  config.get('serverURL');

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

/*
 * Use your own validation token. Check that the token used in the Webhook
 * setup is the same token used here.
 *
 */
app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
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
app.post('/webhook', function (req, res) {
  var data = req.body;

  // Make sure this is a page subscription
  if (data.object == 'page') {
    // Iterate over each entry
    // There may be multiple if batched
    data.entry.forEach(function(pageEntry) {
      var pageID = pageEntry.id;
      var timeOfEvent = pageEntry.time;

      // Iterate over each messaging event
      pageEntry.messaging.forEach(function(messagingEvent) {
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
    //
    // You must send back a 200, within 20 seconds, to let us know you've
    // successfully received the callback. Otherwise, the request will time out.
    res.sendStatus(200);
  }
});

/*
 * This path is used for account linking. The account linking call-to-action
 * (sendAccountLinking) is pointed to this URL.
 *
 */
app.get('/authorize', function(req, res) {
  var accountLinkingToken = req.query['account_linking_token'];
  var redirectURI = req.query['redirect_uri'];

  // Authorization Code should be generated per user by the developer. This will
  // be passed to the Account Linking callback.
  var authCode = "1234567891";

  // Redirect users to this URI on successful login
  var redirectURISuccess = redirectURI + "&authorization_code=" + authCode;

  res.render('authorize', {
    accountLinkingToken: accountLinkingToken,
    redirectURI: redirectURI,
    redirectURISuccess: redirectURISuccess
  });
});


app.post('/validateAuth', function(req, res) {
  var account_linking_token = req.query['account_linking_token'];
  //var redirectURI = req.query['redirect_uri'];

  // Redirect users to this URI on successful login
  //InitConversation(1394374867244519);
  callAuthorizeCallBack(account_linking_token);

  res.render('validateAuth', {
    accountLinkingToken: account_linking_token,
    //redirectURI: redirectURI,
  });
});
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
    // For testing, let's log an error. In production, you should throw an
    // error.
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
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
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message'
 * object format can vary depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
 *
 * For this example, we're going to echo any text that we get. If we get some
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've
 * created. If we receive a message with an attachment (image, video, audio),
 * then we'll simply confirm that we've received the attachment.
 *
 */
function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:",
    senderID, recipientID, timeOfMessage);
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
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s",
      messageId, appId, metadata);
    return;
  } else if (quickReply) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s",
      messageId, quickReplyPayload);

      switch (quickReplyPayload) {
        case "CREDIT_AMOUNT_PAYLOAD":
          sendTextMessage(senderID, "Customer line has been successfully recharged.");
           break;
        default:
          sendTextMessage(senderID, "Quick reply tapped");
      }

    return;
  }

  if (messageText) {

    // If we receive a text message, check to see if it matches any special
    // keywords and send back the corresponding example. Otherwise, just echo
    // the text we received.
    if(messageText.toLowerCase().indexOf("#v")==-1 && messageText.toLowerCase().indexOf("#sc")==-1)
    {
    switch (messageText.toLowerCase()) {

    //Customized For CME BOT
    case 'plans':
    sendPlansMessage(senderID);
    break;

    case 'my id':
    sendTextMessage(senderID, "Your facebook Id: " + senderID);
    break;
    // ./ Customized For CME BOT
      case 'image':
        sendImageMessage(senderID);
        break;

      case 'gif':
        sendGifMessage(senderID);
        break;

      case 'audio':
        sendAudioMessage(senderID);
        break;

      case 'video':
        sendVideoMessage(senderID);
        break;

      case 'file':
        sendFileMessage(senderID);
        break;

      case 'button':
        sendButtonMessage(senderID);
        break;

      case 'generic':
        sendGenericMessage(senderID);
        break;

      case 'receipt':
        sendReceiptMessage(senderID);
        break;

      case 'quick reply':
        sendQuickReply(senderID);
        break;

      case 'read receipt':
        sendReadReceipt(senderID);
        break;

      case 'typing on':
        sendTypingOn(senderID);
        break;

      case 'typing off':
        sendTypingOff(senderID);
        break;

      case 'account linking':
        sendAccountLinking(senderID);
        break;

      default:
        //sendTextMessage(senderID, "Hey John, how can I help you?");
        //sendOffersMessage(senderID);
        InitConversation(senderID)
        //sendTextMessage(senderID, "Offer Plans");
        //sendPlansMessage(senderID);
        //sendTextMessage(senderID, "Promotions");

    }
  }
  else if(messageText.toLowerCase().indexOf("#v")>-1) {
    sendTextMessage(senderID, "Your line has been successfully recharged with 300 JMD.");
  }

  else if(messageText.toLowerCase().indexOf("#sc")>-1) {
    sendCreditsAmounts(senderID);
  }

  } else if (messageAttachments) {
    sendTextMessage(senderID, "Message with attachment received");
  }
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
    messageIDs.forEach(function(messageID) {
      console.log("Received delivery confirmation for message ID: %s",
        messageID);
    });
  }

  console.log("All message before %d were delivered.", watermark);
}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */
 function InitConversation(senderID)
 {
   sendAccountOptionsMessage(senderID);
   sendPromotionsMessage(senderID);
 }

function receivedPostback(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfPostback = event.timestamp;

  // The 'payload' param is a developer-defined field which is set in a postback
  // button for Structured Messages.
  var payload = event.postback.payload;

  console.log("Received postback for user %d and page %d with payload '%s' " +
    "at %d", senderID, recipientID, payload, timeOfPostback);

  // When a postback is called, we'll send a message back to the sender to
  // let them know it was successful

  //CME Customized
  switch (payload) {
    case "RENEW_PLAN_PAYLOAD":
    sendTextMessage(senderID, "Plan has been renewed and valid until 02/01/2017 12:00AM, 150JMD were deduced from your balance. Thank you.");
    break;

    case "DEACTIVATE_PLAN_PAYLOAD":
    sendTextMessage(senderID, "Plan has been deactivated. Thank you.");
    break;

    case "BUY_PLAN_PAYLOAD":
    sendTextMessage(senderID, "Plan activated successfully, 200JMD were deduced from your balance. Thank you.");
    break;

    case "BUY_PLAN_NO_ENOUGH_CREDIT_PAYLOAD":
    sendTextMessage(senderID, "You do not have enough credit to activate this plan, please recharge and reactivate it.\nTo recharge please enter your voucher code followed by #v:");
    break;

    case "GET_STARTED_AUTHORIZE_PAYLOAD":
    sendAccountLinking(senderID);
    break;
    case "GET_STARTED_PAYLOAD":
    InitConversation(senderID);
    //sendTextMessage(senderID, "Hey John, how can I help you?");
    //sendOffersMessage(senderID);
    //sendAccountOptionsMessage(senderID);
    //sendTextMessage(senderID, "Offer Plans");
    //sendPlansMessage(senderID);
    //sendTextMessage(senderID, "Promotions");
    //sendPromotionsMessage(senderID);
    break;

    case "PLANS_PAYLOAD":
    sendTextMessage(senderID, "Offer Plans");
    sendPlansMessage(senderID);
    break;

    case "PROMOTIONS_PAYLOAD":
    sendTextMessage(senderID, "Promotions");
    sendPromotionsMessage(senderID);
    break;

    case "BALANCE_AND_ACTIVE_PLANS_PAYLOAD":
    sendTextMessage(senderID, "Main Balance: 351.91JMD - 660 min(s) left\n\nOther Balances:\nData Remaining: 0.00 MB\nLoyalty Credit: 7.65 JMD\nInternational Minutes: 660 min(s)\n\nActive Plans:");
    //sendTextMessage(senderID,"Active Plans");
    sendActivePlansMessage(senderID);
    break;

    case "ADD_CREDITS_PAYLOAD":
    sendTextMessage(senderID,"Please enter your voucher code followed by #v:");
    break;

    case "SEND_CREDITS_PAYLOAD":
    sendTextMessage(senderID,"Enter phone number followed by #sc:");
    break;

    default:
      sendTextMessage(senderID, "Postback called");
  }

  //if(payload=="PLANS_PAYLOAD")
  //{

  //}
  //if(payload=="")
  //else{
//      sendTextMessage(senderID, "Postback called");
//  }
  //CME Customized
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
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "image",
        payload: {
          url: SERVER_URL + "/assets/rift.png"
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
          url: SERVER_URL + "/assets/instagram_logo.gif"
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
          url: SERVER_URL + "/assets/sample.mp3"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 *
 */
function sendVideoMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "video",
        payload: {
          url: SERVER_URL + "/assets/allofus480.mov"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 *
 */
function sendFileMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "file",
        payload: {
          url: SERVER_URL + "/assets/test.txt"
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "This is test text",
          buttons:[{
            type: "web_url",
            url: "https://www.oculus.com/en-us/rift/",
            title: "Open Web URL"
          }, {
            type: "postback",
            title: "Trigger Postback",
            payload: "DEVELOPED_DEFINED_PAYLOAD"
          }, {
            type: "phone_number",
            title: "Call Phone Number",
            payload: "+16505551234"
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a Structured Message (Generic Message type) using the Send API.
 *
 */

 // CME Customized
 function sendCreditsAmounts(recipientId)
 {
   var messageData = {
     recipient: {
       id: recipientId
     },
     message: {
      "text": "Select Transfer Amount: (JMD)",
      "metadata": "DEVELOPER_DEFINED_METADATA",
      "quick_replies": [
        {
          "content_type":"text",
          "title":"15",
          "payload":"CREDIT_AMOUNT_PAYLOAD"
        },
        {
          "content_type":"text",
          "title":"25",
          "payload":"CREDIT_AMOUNT_PAYLOAD"
        },
        {
          "content_type":"text",
          "title":"50",
          "payload":"CREDIT_AMOUNT_PAYLOAD"
        },
        {
          "content_type":"text",
          "title":"100",
          "payload":"CREDIT_AMOUNT_PAYLOAD"
        }
      ]
    }
   };

   callSendAPI(messageData);
 }

 function sendOffersMessage(recipientId){

   var messageData = {
     recipient: {
       id: recipientId
     },
     message: {
       attachment: {
         type: "template",
         payload: {
           template_type: "button",
           text: "Our latest offers:",
           buttons:[{
             type: "postback",
             title: "Offer Plans",
             payload: "PLANS_PAYLOAD"
           },{
             type: "postback",
             title: "Promotions",
             payload: "PROMOTIONS_PAYLOAD"
           }]
         }
       }
     }
   };

   callSendAPI(messageData);
 }

 function sendAccountOptionsMessage(recipientId)
 {
   var messageData = {
     recipient: {
       id: recipientId
     },
     message: {
       attachment: {
         type: "template",
         payload: {
           template_type: "button",
           text: "Account Details",
           buttons:[{
             type: "postback",
             title: "My Balance & Plans",
             payload: "BALANCE_AND_ACTIVE_PLANS_PAYLOAD"
           }, {
             type: "postback",
             title: "Add Credits",
             payload: "ADD_CREDITS_PAYLOAD"
           }, {
             type: "postback",
             title: "Send Credits",
             payload: "SEND_CREDITS_PAYLOAD"
           }]
         }
       }
     }
   };
   callSendAPI(messageData);

 }
function sendActivePlansMessage(recipientId)
{
  var messageData = {
    recipient: {
      id: recipientId
    },
    "message": {
       "attachment": {
         "type": "template",
         "payload": {
           "template_type": "generic",
           "elements": [{
             "title": "D'Music Premium Plan",
             "subtitle": "Valid till 30/09/2016 08:05PM",
             "buttons": [{
               "type": "postback",
               "payload": "RENEW_PLAN_PAYLOAD",
               "title": "Renew"
             },
             {
               "type": "postback",
               "payload": "DEACTIVATE_PLAN_PAYLOAD",
               "title": "Deactivate"
             }]
           },
           {
             "title": "In'tl 1000",
             "subtitle": "Valid till 29/09/2016 11:15AM",
             "buttons": [{
               "type": "postback",
               "payload": "RENEW_PLAN_PAYLOAD",
               "title": "Renew"
             },
             {
               "type": "postback",
               "payload": "DEACTIVATE_PLAN_PAYLOAD",
               "title": "Deactivate"
             }]
           }]
         }
       }
     }
  };

  callSendAPI(messageData);
}

function sendPromotionsMessage(recipientId) {
  var messageData = {
    "recipient": {
      "id": recipientId
    },
    "message": {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [{
            title: "Be A Millionaire",
            subtitle: "1st Grand Prize 2,000,000$",
            image_url: SERVER_URL + "/assets/jamjackpot.png",
            buttons: [{
              type: "postback",
              payload: "BUY_PLAN_PAYLOAD",
              title: "Buy Now"
            }]
          },
          {
            title: "LTE Prepaid Smart Plan",
            subtitle: "1GB - 7 Days for 900$",
            image_url: SERVER_URL + "/assets/jamltepre.png",
            buttons: [{
              type: "postback",
              payload: "BUY_PLAN_NO_ENOUGH_CREDIT_PAYLOAD",
              title: "Buy Now"
            }]
          },
          {
            "title": "PROUD SPONSOR OF WEST INDIES CRICKET",
            "image_url": SERVER_URL + "/assets/promo-1.jpg",
            "buttons": [{
              "type": "web_url",
               "url": "https://www.digicelgroup.com/en/media/news/2016/may/24/-winning-ways-continue-with-new-digicel-wicb-partnership.html",
              "title": "Read More"
            }]
          },
          {
            "title": "GO MOBILE!",
            "subtitle":"Keeping you connected wherever you are.",
            "image_url": SERVER_URL + "/assets/promo-2.jpg",
            "buttons": [{
              "type": "web_url",
               "url": "https://www.digicelgroup.com/en/what-we-do/mobile.html",
              "title": "Learn More"
            }]
          },
          {
            "title": "COMPLETE BUSINESS SOLUTIONS",
            "subtitle":"Finding the right solution for you",
            "image_url": SERVER_URL + "/assets/promo-3.jpg",
            "buttons": [{
              "type": "web_url",
               "url": "https://www.digicelgroup.com/en/what-we-do/business-solutions.html",
              "title": "Learn More"
            }]
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}
 function sendPlansMessage(recipientId) {
   var messageData = {
     recipient: {
       id: recipientId
     },
     message: {
       attachment: {
         type: "template",
         payload: {
           template_type: "generic",
           elements: [{
             title: "Be A Millionaire",
             subtitle: "1st Grand Prize 2,000,000$",
             item_url: "https://product-staging.digicelgroup.com/selfcare3/img/whatsnew/jamjackpot.png",
             image_url: SERVER_URL + "/assets/jamjackpot.png",
             buttons: [{
               type: "web_url",
               url: "https://product-staging.digicelgroup.com/selfcare3/img/whatsnew/jamjackpot.png",
               title: "Buy Now",
             }]
           },
           {
             title: "LTE Prepaid Smart Plan",
             subtitle: "1GB - 7 Days for 900$",
             item_url: "https://product-staging.digicelgroup.com/selfcare3/img/whatsnew/jamltepre.png",
             image_url: SERVER_URL + "/assets/jamltepre.png",
             buttons: [{
               type: "web_url",
               url: "https://product-staging.digicelgroup.com/selfcare3/img/whatsnew/jamltepre.png",
               title: "Buy Now",
             }]
           },
           {
             title: "LTE Prepaid Smart Plan",
             subtitle: "1GB - 7 Days for 900$",
             item_url: "https://product-staging.digicelgroup.com/selfcare3/img/whatsnew/jamltepre.png",
             image_url: SERVER_URL + "/assets/jamltepre.png",
             buttons: [{
               type: "web_url",
               url: "https://product-staging.digicelgroup.com/selfcare3/img/whatsnew/jamltepre.png",
               title: "Buy Now",
             }]
           }]
         }
       }
     }
   };

   callSendAPI(messageData);
 }
 // /. CME Customized
function sendGenericMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "rift",
            subtitle: "Next-generation virtual reality",
            item_url: "https://www.oculus.com/en-us/rift/",
            image_url: SERVER_URL + "/assets/rift.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/rift/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for first bubble",
            }],
          }, {
            title: "touch",
            subtitle: "Your Hands, Now in VR",
            item_url: "https://www.oculus.com/en-us/touch/",
            image_url: SERVER_URL + "/assets/touch.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/touch/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for second bubble",
            }]
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a receipt message using the Send API.
 *
 */
function sendReceiptMessage(recipientId) {
  // Generate a random receipt ID as the API requires a unique ID
  var receiptId = "order" + Math.floor(Math.random()*1000);

  var messageData = {
    recipient: {
      id: recipientId
    },
    message:{
      attachment: {
        type: "template",
        payload: {
          template_type: "receipt",
          recipient_name: "Peter Chang",
          order_number: receiptId,
          currency: "USD",
          payment_method: "Visa 1234",
          timestamp: "1428444852",
          elements: [{
            title: "Oculus Rift",
            subtitle: "Includes: headset, sensor, remote",
            quantity: 1,
            price: 599.00,
            currency: "USD",
            image_url: SERVER_URL + "/assets/riftsq.png"
          }, {
            title: "Samsung Gear VR",
            subtitle: "Frost White",
            quantity: 1,
            price: 99.99,
            currency: "USD",
            image_url: SERVER_URL + "/assets/gearvrsq.png"
          }],
          address: {
            street_1: "1 Hacker Way",
            street_2: "",
            city: "Menlo Park",
            postal_code: "94025",
            state: "CA",
            country: "US"
          },
          summary: {
            subtotal: 698.99,
            shipping_cost: 20.00,
            total_tax: 57.67,
            total_cost: 626.66
          },
          adjustments: [{
            name: "New Customer Discount",
            amount: -50
          }, {
            name: "$100 Off Coupon",
            amount: -100
          }]
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
function sendQuickReply(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: "What's your favorite movie genre?",
      metadata: "DEVELOPER_DEFINED_METADATA",
      quick_replies: [
        {
          "content_type":"text",
          "title":"Action",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_ACTION"
        },
        {
          "content_type":"text",
          "title":"Comedy",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_COMEDY"
        },
        {
          "content_type":"text",
          "title":"Drama",
          "payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_DRAMA"
        }
      ]
    }
  };

  callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {
  console.log("Sending a read receipt to mark message as seen");

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
  console.log("Turning typing indicator on");

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
  console.log("Turning typing indicator off");

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
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [{
            "title": "Welcome to Digicel",
            "image_url": SERVER_URL + "/assets/small-logo.png",
            "buttons": [{
              "type": "account_link",
               "url": SERVER_URL + "/authorize"
            }]
          }]
        }
      }
    }
  };

  callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
 function callAuthorizeCallBack(account_linking_token)
 {
   request({
     uri: 'https://graph.facebook.com/v2.6/me?access_token='+PAGE_ACCESS_TOKEN+'&fields=recipient&account_linking_token='+account_linking_token,
     //qs: { access_token: PAGE_ACCESS_TOKEN , fields:'recipient', account_linking_token: account_linking_token },
     method: 'GET'
   }, function (error, response, body) {
     if (!error && response.statusCode == 200) {
       var recipientId = body.recipient;
       //alert(recipientId);
       if (recipientId) {
         //alert(recipientId);
          InitConversation(recipientId);
       } else {
         //alert("error");
       console.log("error in get");
       }
     } else {
       //alert(response.error);
       console.error(response.error);
     }
   });

 }

function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
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
      console.error(response.error);
    }
  });
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid
// certificate authority.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;
