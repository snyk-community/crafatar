var logging = require('./logging');
var request = require('request');
var config = require('./config');
var skins = require('./skins');
var fs = require("fs");

var session_url = "https://sessionserver.mojang.com/session/minecraft/profile/";
var skins_url = "https://skins.minecraft.net/MinecraftSkins/";

// exracts the skin url of a +profile+ object
// returns null when no url found (user has no skin)
function extract_skin_url(profile) {
  var url = null;
  if (profile && profile.properties) {
    profile.properties.forEach(function(prop) {
      if (prop.name == 'textures') {
        var json = Buffer(prop.value, 'base64').toString();
        var props = JSON.parse(json);
        url = props && props.textures && props.textures.SKIN && props.textures.SKIN.url || null;
      }
    });
  }
  return url;
}

// make a request to skins.miencraft.net
// the skin url is taken from the HTTP redirect
var get_username_url = function(name, callback) {
  request.get({
    url: skins_url + name + ".png",
    timeout: config.http_timeout,
    followRedirect: false
  }, function(error, response, body) {
    if (!error && response.statusCode == 301) {
      // skin_url received successfully
      logging.log(name + " skin url received");
      callback(null, response.headers.location);
    } else if (error) {
      callback(error, null);
    } else if (response.statusCode == 404) {
      // skin doesn't exist
      logging.log(name + " has no skin");
      callback(0, null);
    } else if (response.statusCode == 429) {
      // Too Many Requests
      // Never got this, seems like skins aren't limited
      logging.warn(name + " Too many requests");
      logging.warn(body);
      callback(null, null);
    } else {
      logging.error(name + " Unknown error:");
      logging.error(response);
      logging.error(body);
      callback(null, null);
    }
  });
};

// make a request to sessionserver
// the skin_url is taken from the profile
var get_uuid_url = function(uuid, callback) {
  request.get({
    url: session_url + uuid,
    timeout: config.http_timeout // ms
  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      // profile downloaded successfully
      logging.log(uuid + " profile downloaded");
      callback(null, extract_skin_url(JSON.parse(body)));
    } else if (error) {
      callback(error, null);
    } else if (response.statusCode == 204 || response.statusCode == 404) {
      // we get 204 No Content when UUID doesn't exist (including 404 in case they change that)
      logging.log(uuid + " uuid does not exist");
      callback(0, null);
    } else if (response.statusCode == 429) {
      // Too Many Requests
      logging.warn(uuid + " Too many requests");
      logging.warn(body);
      callback(null, null);
    } else {
      logging.error(uuid + " Unknown error:");
      logging.error(response);
      logging.error(body);
      callback(null, null);
    }
  });
};

var exp = {};

// download skin_url for +uuid+ (name or uuid)
// callback contains error, skin_url
exp.get_skin_url = function(uuid, callback) {
  if (uuid.length <= 16) {
    get_username_url(uuid, function(err, url) {
      callback(err, url);
    });
  } else {
    get_uuid_url(uuid, function(err, url) {
      callback(err, url);
    });
  }
};

// downloads skin file from +url+
// stores face image as +facename+
// stores helm image as +helmname+
// callback contains error
exp.skin_file = function(url, facename, helmname, callback) {
  if (fs.existsSync(facename) && fs.existsSync(facename)) {
    logging.log("Images already exist, not downloading.");
    callback(null);
    return;
  }
  request.get({
    url: url,
    encoding: null, // encoding must be null so we get a buffer
    timeout: config.http_timeout // ms
  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      // skin downloaded successfully
      logging.log(url + " skin downloaded");
      skins.extract_face(body, facename, function(err) {
        if (err) {
          callback(err);
        } else {
          logging.log(facename + " face extracted");
          skins.extract_helm(facename, body, helmname, function(err) {
            logging.log(helmname + " helm extracted.");
            callback(err);
          });
        }
      });
    } else {
      if (error) {
        logging.error("Error downloading '" + url + "': " + error);
      } else if (response.statusCode == 404) {
        logging.warn("texture not found (404): " + url);
      } else if (response.statusCode == 429) {
        // Too Many Requests
        // Never got this, seems like textures aren't limited
        logging.warn("too many requests for " + url);
        logging.warn(body);
      } else {
        logging.error("unknown error for " + url);
        logging.error(response);
        logging.error(body);
        error = "unknown error"; // Error needs to be set, otherwise null in callback
      }
      callback(error);
    }
  });
};

module.exports = exp;