const MailListener = require("mail-listener2");
const fs = require('fs');
const mkdirp = require('mkdirp');
const gm = require('gm');
const winston = require('winston');
const util = require('util');
const moment = require('moment-timezone');

const config = require('./config/config');
const customersConfig = require('./config/customers');

let mailListenerConfig = config.mailListener;
let customers = [];
let logger = new (winston.Logger)({
    transports: [
      new (winston.transports.Console)({
        level: config.winston.consoleLogLevel
      }),
      new (winston.transports.File)({
        filename: config.winston.logfilePath,
        level: config.winston.fileLogLevel
      })
    ]
  });

customersConfig.forEach(function(customerConfig){
  let mailListener = new MailListener(Object.assign({}, mailListenerConfig, customerConfig.mailListener));
  mailListener.on("server:connected", function(){
    logger.info("[%s] imapConnected", customerConfig.customerInfo.name);
  });

  mailListener.on("server:disconnected", function(){
    logger.warn("[%s] imapDisconnected", customerConfig.customerInfo.name);
    this.start();
  });

  mailListener.on("error", function(err){
    logger.error("[%s] imap error: ", customerConfig.customerInfo.name, err);
  });

  mailListener.on("mail", function(mail, seqno, attributes){
    logger.info("[%s] Email Recived: %j", customerConfig.customerInfo.name, mail.messageId);
    if(customerConfig.acceptedUsers.some(x => x.emailAddress.includes(mail.from[0].address))){
      logger.info("[%s] Email address in acceptedEmailAddress: %s", customerConfig.customerInfo.name, mail.from[0].address);
      if(mail.hasOwnProperty("attachments")){
        mail.attachments.forEach(function(attachment){
          //console.log(mail);
          logger.info("[%s] attachment found in %s: ", customerConfig.customerInfo.name, mail.messageId, attachment.generatedFileName);
          if (attachment.contentType === "image/jpeg") {
            let date;
            gm(attachment.content)
            .identify(function (err, data) {
              if (err){
                logger.warn("[%s] Unable to read metadata from image %s in email [%s], Error: ", customerConfig.customerInfo.name, attachment.generatedFileName, mail.messageId, err);
              } else {
                if (data.hasOwnProperty('Profile-EXIF') && (data['Profile-EXIF'].hasOwnProperty('Date Time Original') || data['Profile-EXIF'].hasOwnProperty('Date Time'))){
                  date = data['Profile-EXIF']['Date Time Original']  || data['Profile-EXIF']['Date Time'];

                  //convert Date format in Javascript
                  tmp = date.split(" ");
                  tmp[0] = tmp[0].split(":").join("-");
                  //date = new Date(tmp[0] + "T" + tmp[1]);
                  date = moment.tz(tmp[0] + "T" + tmp[1], "Europe/Stockholm");

                  let subject = mail.subject
                  let user = customerConfig.acceptedUsers.find(function(user) {
                    return user.emailAddress.includes(mail.from[0].address);
                  });
                  let filename = util.format("%s [%s] %s.jpg", date.format('YYYY-MM-DDThh.mm.ss'), user.name, subject)
                  let path = util.format("%s%s/%s/%s/", customerConfig.abbir.imagePath, date.format('YYYY'), date.format('MM'), date.format('DD'))
                  mkdirp(path, function(err) {
                    if (err){
                      logger.warn("[%s] Unable to create path %s, Error: ", customerConfig.customerInfo.name, path, err);
                    } else {
                      let filePath = path + filename;
                      gm(attachment.content)
                      .comment(util.format("%s. Sent from %s (%s) ", subject, user.name, mail.from[0].address))
                      .resize(customerConfig.abbir.imageSize, customerConfig.abbir.imageSize)
                      .write(filePath, function (err) {
                        if (err){
                          logger.warn("[%s] Unable to save/resize image %s from email [%s], Error: ", customerConfig.customerInfo.name, attachment.generatedFileName, mail.messageId, err);
                        } else {
                          logger.info("[%s] Image %s saved and resized from email [%s]", customerConfig.customerInfo.name, attachment.generatedFileName, mail.messageId);
                          try {
                              fs.utimesSync(filePath, new Date(date), new Date(date));
                          } catch (err) {
                              logger.warn("[%s] Unable to update timestamp in image %s to %s, Error: ", customerConfig.customerInfo.name, filePath, date, err);
                          }
                        }
                      });
                    }
                  });
                }
              }
            });
          } else {
            logger.info("[%s] Attachment, %s, in email %s, is not an image/jpeg: %s", customerConfig.customerInfo.name, attachment.generatedFileName, mail.messageId, attachment.attachment.contentType);
          }
        });
      } else {
        logger.warn("[%s] Email [%s] has no attachments", customerConfig.customerInfo.name, mail.messageId);
      }
    } else {
      logger.info("[%s] Email address not in acceptedEmailAddress: %s", customerConfig.customerInfo.name, mail.from[0].address);
    }

    if(false){
      mailListener.imap.seq.setFlags(seqno, ['Seen', 'Deleted'], function(err) {
        if (err) {
          logger.error("[%s] Unable to mark email [%s] as Seen and flag for Deletion}, Error: %j", customerConfig.customerInfo.name, mail.messageId, err)
        }
        logger.info("[%s] Email [%s] marked as seen and flag for delete: ", customerConfig.customerInfo.name, mail.messageId)
        mailListener.imap.expunge(seqno);
      });
    }
  });
  customers.push({
    customerConfig: customerConfig,
    mailListener : mailListener
  });
});

customers.forEach(function (customer) {
  customer.mailListener.start();
});


// stop listening
//mailListener.stop();
