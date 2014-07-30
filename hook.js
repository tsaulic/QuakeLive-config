/**
 * QUAKE LIVE HOOK MANAGER
 * Version: 0.3
 */

// called in ql.Init
function main_hook() {
  console.log("main_hook called");
  if (quakelive.mod_legals !== quakelive.activeModule) HOOK_MANAGER.init();
}


(function(aWin, undefined) {
/**
 * IMPORTANT:  Unless you really know what you're doing, the "config" properties below should be all
 * you need to change in this file.
 */
var config = {
    BASE_URL: "http://qlhm.phob.net/"
  , manual: []
  , debug: false
};

// !!!
// IMPORTANT:  Changing anything below this point might break things!
// !!!


// This is the service that acts as a proxy to retrieve userscripts.  It also does some extra work,
// such as pre-parsing of the userscript metadata block.
var JSONP_PROXY_TEMPLATE = config.BASE_URL + "uso/{{id}}";

// This is used to determine whether `hook.js` and the proxy service are on the same version.
var VERSION_CHECK_URL = config.BASE_URL + "versioncheck";

// List of userscripts shown in the HOOK console
var USERSCRIPT_REPOSITORY_URL = config.BASE_URL + "qlhmUserscriptRepository.js";

// This is used to indicate if /web_reload is required (e.g. scripts were enabled or disabled)
var webReloadRequired = false;

// Local reference to jQuery (set during initialization)
var $;

/**
 * Helpers
 */
// Defines a read-only property on an object (enumerable by default)
function readOnly(aObj, aProp, aVal, aEnum) {
  aEnum = undefined === aEnum ? true : !!aEnum;
  Object.defineProperty(aObj, aProp, {get: function() { return aVal }, enumerable: aEnum});
}

// Simple extend with exceptions
function extend(aTarget, aSource, aProtect) {
  aProtect = Array.isArray(aProtect) ? aProtect : [];
  for (var p in aSource) {
    if (-1 === aProtect.indexOf(p)) {
      aTarget[p] = aSource[p];
    }
  }
}

// Escape HTML
// originally from mustache.js MIT ( https://raw.github.com/janl/mustache.js/master/LICENSE )
var entityMap = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "/": "&#x2F;" };
function e(aStr) {
  return String(aStr).replace(/[&<>"'\/]/g, function(s) {
    return entityMap[s];
  });
}

function injectStyle(aStyle) {
  var s = document.createElement("style");
  s.type = "text/css";
  s.textContent = Array.isArray(aStyle) ? aStyle.join("") : aStyle;
  document.body.appendChild(s);
}

function injectScript(aScript) {
  var s = document.createElement("script");
  s.type = "text/javascript";
  s.innerHTML = aScript;
  document.body.appendChild(s);
  document.body.removeChild(s);
}


/**
 * localStorage Manager
 */
var storage = Object.create(null);
readOnly(storage, "root", "qlhm");
readOnly(storage, "init", function storageInit(aCallback, aForceReset) {
  var STORAGE_TEMPLATE = {settings: {}, scripts: {available: [], enabled: [], cache: {}}};

  if (aForceReset) console.log("^1WARNING: ^7resetting QLHM localStorage");

  if (!aForceReset && storage.root in localStorage) {
    try {
      var tmp = JSON.parse(localStorage[storage.root]);
      extend(storage, {settings: tmp.settings, scripts: tmp.scripts});
    }
    catch(e) {}
  }

  if (aForceReset || !storage.settings || !jQuery.isPlainObject(storage.settings)) {
    storage.scripts = STORAGE_TEMPLATE.scripts;
    storage.settings = STORAGE_TEMPLATE.settings;
    storage.save();
  }

  aCallback();
});
readOnly(storage, "save", function storageSave() {
  setTimeout(function() {
    localStorage[storage.root] = JSON.stringify({settings: storage.settings, scripts: storage.scripts});
  }, 0);
});


/**
 * HUD Manager
 */
function HudManager(aHookManager) {
  readOnly(this, "hm", aHookManager);
  readOnly(this, "width", 900);
  this.selectedScriptElement = null;
  
  quakelive.AddHook("OnLayoutLoaded", this.OnLayoutLoaded.bind(this));

  // 2013-11-23 window.alert is currently unhandled... remove this if native (i.e. non-JS) option
  // is enabled.
  if ("function alert() { [native code] }" != (aWin.alert+"")) {
    aWin.alert = function(aMsg) {
      console.log("ALERT: " + aMsg);
    }
  }
}

HudManager.prototype.alert = function(aOptions) {
  var self = this;
  var opts = $.extend({title: self.hm.name}, aOptions, {alert: true});
  qlPrompt(opts);
}

HudManager.prototype.OnLayoutLoaded = function() {
  var layout = quakelive.activeModule ? quakelive.activeModule.GetLayout() : "";
  // Proper layout and no existing menu?
  if ("bare" !== layout && "postlogin_bare" !== layout && !$("#hooka").length) {
    this.injectMenuEntry();
  }
}

HudManager.prototype.injectMenuEntry = function() {
  var self = this;

  injectStyle([
      "#hooka { position: relative; bottom: 20px; left: 10px; z-index: 99999; font-weight: bold; padding: 2px; text-shadow: 0 0 10px #000; }"
    , "#hooka:hover { cursor: pointer; text-shadow: 0 0 10px yellow; }"
    , "#qlhm_console { text-align: left !important; width: 100%; }"
    , "#qlhm_console #detailspane { float: right; position: relative; top: 0px; width: 270px; }"
    , "#qlhm_console strong, #qlhm_console legend { font-weight: bold; }"
    , "#qlhm_console fieldset { margin: 10px 0 20px 0; padding: 5px; }"
    , "#qlhm_console ul { list-style: none; }"
    , "#qlhm_console ul li { margin-top: 5px; whitespace: nowrap; overflow:hidden; }"
    , "#qlhm_console ul li.selected { background-color: #ffc; }"
    , "#qlhm_console input.userscript-new { width: 400px; margin-bottom: 5px; }"
    , "#qlhm_console a.del, #qlhm_console a.viewSource { text-decoration: none; }"
    , "#qlhm_console .italic { font-style: italic; }"
    , "#qlhm_console .strike { text-decoration: line-through; }"
    , "#qlhm_console .underline { text-decoration: underline; }"
    , "#qlhm_console .details { margin-left: 15px; font-size: smaller; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: " + (self.width - 50) + "px; }"
    , "#qlhm_console .table { display: table; }"
    , "#qlhm_console .row { display: table-row; }"
    , "#qlhm_console .cell { display: table-cell; padding-right: 10px; }"
    , "#qlhm_console .notInstalled { color: #aaa; }"
    , "#userscripts { overflow: auto; width: 550px; max-height: 400px; }"
    , "#qlhmSource textarea.userscript-source { width: " + (self.width - 140) + "px; }"
  ]);

  $("#qlv_mainLogo").append($("<a id='hooka'>HOOK</a>").click(function() { self.showConsole.call(self); return false; }));
}

HudManager.prototype.scriptRowFromScript = function(aScript) {
  var id = aScript._meta.id
    , enabled = -1 !== storage.scripts.enabled.indexOf(id)
    , desc = aScript.headers.description ? e(aScript.headers.description[0]) : "<em>Unspecified</em>"
    ;

  return "<li id='userscript" + id + "' data-id='" + id + "'>"
       + "<input type='checkbox' class='userscript-state' " + (enabled ? "checked" : "") + ">"
       + " <label for='userscript" + id + "'><a href='javascript:void(0)'>" + e(aScript.headers.name[0]) + "</a></label>"
       //+ "<br><div class='details'>" + desc + "</div>"
       + "</li>";
}

HudManager.prototype.scriptRowFromScriptRepository = function(aScriptInfo) {
  var id = aScriptInfo.id;
  return "<li id='userscript" + id + "' data-id='" + id + "'>"
       + "<input type='checkbox' class='userscript-state'>"
       + " <label for='userscript" + id + "'>"
       + "<a class='notInstalled italic' href='javascript:void(0)' target='_empty'>" + e(aScriptInfo.name) + "</a></label>"
       + "</li>";
}

HudManager.prototype.showConsole = function() {
  var self = this;

  $.getScript(USERSCRIPT_REPOSITORY_URL)
    .done(function() { self.onRepositoryLoaded(); })
    .fail(function() { self.onRepositoryLoaded(); });    
}

HudManager.prototype.onRepositoryLoaded = function() {
  var self = this;

  webReloadRequired = false;

  // Get and sort all scripts
  var scripts = [];
  for (var i = 0, e = storage.scripts.available.length; i < e; ++i) {
    scripts.push(storage.scripts.cache[storage.scripts.available[i]]);
  }
  $.each(HOOK_MANAGER.userscriptRepository, function(index, script) {
    if (storage.scripts.available.indexOf(script.id) == -1)
      scripts.push(script);
  });
  
  scripts.sort(function(a, b) {
    var x = a.headers ? a.headers.name[0] : a.name;
    var y = b.headers ? b.headers.name[0] : b.name;
    x = x.toLowerCase(), y = y.toLowerCase();
    return (x < y ? -1 : x > y ? 1 : 0);
  });

  // Generate the console
  var out = [];
  out.push("<div id='qlhm_console'>");
  out.push("<fieldset>");
  out.push("<b>Add Scripts:</b>");
  out.push(" &nbsp; <input type='text' class='userscript-new' placeholder='Enter userscripts.org (USO) script IDs directly -or- select from below'>");
  out.push("<div>");
  out.push("</fieldset>");

  out.push("<div id='detailspane'>");
  out.push("<b class='underline'>Script Details</b>");
  out.push("<div id='scriptDetails'>(click on a script to see the details)</div>");
  out.push("</div>");

  out.push("<div>");
  out.push("<fieldset>");
  out.push("<b>User Scripts</b>");
  out.push(" &nbsp; ");
  out.push("(<a class='selectall' href='javascript:void(0)'>select all</a>");
  out.push(" - <a class='unselectall' href='javascript:void(0)'>unselect all</a>");
  out.push(" - <a class='deleteunsel' href='javascript:void(0)'>delete unselected</a>");
  out.push(")");
  out.push("<ul id='userscripts'>");
  $.each(scripts, function(i, script) {
    if (script._meta)
      out.push(self.scriptRowFromScript(script));
    else
      out.push(self.scriptRowFromScriptRepository(script));
  });
  out.push("</ul>");
  out.push("</fieldset>");
  out.push("</div>");
  
  out.push("</div>");

  // Inject the console
  qlPrompt({
      id: "qlhmPrompt"
    , title: self.hm.name + " <small>(v" + self.hm.version + ")</small>"
    , customWidth: self.width
    , ok: self.handleConsoleOk.bind(self)
    , okLabel: "Apply"
    , cancel: self.handleConsoleClose.bind(self)
    , cancelLabel: "Close"
    , body: out.join("")
  });

  // Wait for the prompt to get inserted then do stuff...
  setTimeout(function() {
    $("#modal-cancel").focus();

    var $ui = $("#qlhm_console");
    $ui.on("keydown", function(ev) {
        // Suppress backtick (99.999% intended for the QL console)
        if (192 == ev.keyCode) ev.preventDefault();
       })
       .on("click", "#userscripts li", function() { self.showDetails(this); })
       .on("click", ".selectall", function () { $ui.find(":checkbox").prop("checked", true); })
       .on("click", ".unselectall", function () { $ui.find(":checkbox").prop("checked", false); })
       .on("click", ".deleteunsel", function() {
          $ui.find(":checkbox").each(function(index, item) {
            var $item = $(item);
            if (!$item.prop("checked") && !$item.parent().find("a").hasClass("notInstalled")) {
              $item.closest("li").data("toDelete", true).find("label").addClass("strike");               
            }
            self.showDetails();
          });
       });
  }, 0);
};

HudManager.prototype.showDetails = function(elem) {
  var self = this
    , $details = $("#scriptDetails")
    ;

  $("#userscripts li").removeClass("selected");
  $details.empty();

  if (!elem) {
    if (self.selectedScriptElement && $(self.selectedScriptElement).length > 0) {
      elem = self.selectedScriptElement;
    }
    else {
      $details.append("(click on a script to see its details)");
      self.selectedScriptElement = null;
      return;
    }
  }

  var $elem = $(elem)
    , id = $elem.closest("li").data("id")
    , cacheScript = storage.scripts.cache[id]
    ;

  var author, version, descr, entrySource, deleteCaption;    

  self.selectedScriptElement = elem;
  $elem.addClass("selected");

  if (cacheScript) {
    author = e(cacheScript.headers.author);
    version = e(cacheScript.headers.version);
    descr = e(cacheScript.headers.description);
    entrySource = "User Installation";
    deleteCaption = $("#userscript"+id).data("toDelete") ? "UNDELETE" : "DELETE";
  }
  else {
    var repoScript = $.grep(HOOK_MANAGER.userscriptRepository, function(item) { return item.id == id; })[0];
    author = repoScript.author;
    version = "<i>not installed</i>";
    descr = repoScript.note ? ("<b>NOTE:</b><br>" + repoScript.note) : "";
    entrySource = "QLHM Repository";
    deleteCaption = "";
  }

  $details.append("<div class='table'>"
    + "<div class='row'>"
    + "<div class='cell'><b>USO ID:</b></div>"
    + "<div class='cell'><a href='https://userscripts.org/scripts/show/" + id + "' target='_empty'>" + id + "</a></div>"
    + "</div>"
    + "<div class='row'><div class='cell'><b>Author:</b></div><div class='cell'>" + author + "</div></div>"
    + "<div class='row'><div class='cell'><b>Version:</b></div><div class='cell'>" + version + "</div></div>"
    + "<div class='row'><div class='cell'><b>Listed Due To:</b></div><div class='cell'>" + entrySource + "</div></div>"
    + "</div>"    
    + "<br>" + (descr ? ("<p>" + descr + "</p><br>") : "")
  );

  if (cacheScript) {
    $details.append("<a href='javascript:void(0)' data-id='" + id + "' class='del'>[" + deleteCaption + "]</a>"
      + " &nbsp; <a href='javascript:void(0)' data-id='" + id + "' class='viewSource'>[SOURCE]</a>"
    );
  }
  else {
    $details.append("<span class='italic'>Mark the checkbox and hit \"Apply\" to install.</span>");
  }

  $details.find(".viewSource").click(function() {
    // Open a prompt to show the selected userscript's source       
    self.showSource($(this).data("id"));
  });

  $details.find(".del").click(function() {
    // Toggle a userscript being marked as deleted
    var $this = $(this)
      , id = $this.data("id")
      , $item = $("#userscript" + id)
      , toDelete = $item.data("toDelete")
      ;

    if (toDelete) {
      $item.data("toDelete", false).find("label").removeClass("strike");
      $this.text("[DELETE]");
    } 
    else {
      $item.data("toDelete", true).find("label").addClass("strike");
      $this.text("[UNDELETE]");
    }
  });
};

HudManager.prototype.showSource = function(aScriptID) {
  var self = this;
  qlPrompt({
      id: "qlhmSource"
    , title: "Script Source Code: " + aScriptID
    , alert: true
    , customWidth: self.width - 100
    , customHeight: 850
    , body: "<b>NOTE:</b> Currently read-only</p>"
          + "<textarea class='userscript-source' rows='30'>" + self.hm.getUserScriptSource(aScriptID) + "</textarea>"
  });
}

HudManager.prototype.handleConsoleOk = function() {
  var self = this
    , $con = $("#qlhm_console")
    , $uNew = $con.find("input.userscript-new")
    , ids = $uNew.val()
    ;

  // delete or disable scripts
  $con.find("input.userscript-state").each(function() {
    var $input = $(this)
      , $item = $input.closest("li")
      , id = parseInt($item.data("id"))
      ;

    // Should this userscript be deleted
    if ($item.data("toDelete")) {
      if (storage.scripts.enabled.indexOf(id) !== -1) {
        webReloadRequired = true;
      }

      self.hm.removeUserScript(id);

      // only remove non-repository scripts from UI
      if (0 === $.grep(HOOK_MANAGER.userscriptRepository, function(item) { return item.id == id; }).length) {
        $item.remove();
      }
      else {
        $item.find("label").removeClass("strike");
        $item.find("a").addClass("notInstalled");
      }

      $input.attr("checked", false);
      $item.data("toDelete", false);
    }
    // ... otherwise just check if disabled or enabled
    else if (self.hm.hasUserScript(id)) {
      webReloadRequired |= self.hm.toggleUserScript(id, $input.prop("checked"));
    }
  });

  // add new scripts
  ids = ids.replace(/https:\/\/userscripts\.org\/scripts\/[a-z]+\//g, "").replace(/[^\d,]/g, "");
  ids = ids.split(",").map(function(id) { return parseInt(id.trim()); });

  $con.find("input.userscript-state").each(function() {
    var $input = $(this)
      , $item = $input.closest("li")
      , id = parseInt($item.data("id"))
      ;

    if ($input.prop("checked") && !self.hm.hasUserScript(id)) {            
      ids.push(id);
    }
  });

  $.each(ids, function(i, id) {
    // New userscript?
    if (id && !isNaN(id)) {
      if (self.hm.hasUserScript(id)) {
        console.log("The userscript with ID " + id + " already exists.  Try removing it first.");
      }
      else {
        console.log("Trying to fetch userscript with ID '" + id + "'");
        var $script = $("#userscript" + id);
        $script.find("a").removeClass("notInstalled");
        $script.find(":checkbox").prop("checked", true);
        self.hm.fetchScript(id, function(aScript) {
          // TODO: manage the userscript list better... this won't necessarily be in the correct position
          if (0 === $("#userscript" + id).length)
            $con.find("#userscripts").append(self.scriptRowFromScript(aScript));
          self.showDetails();
        });
      }
    }
  });

  $uNew.val("");

  
  if (webReloadRequired) {
    //$("#modal-buttons").append("<span style='color:#c00000; font-size: 12pt'> ... and reload website</span>");
    $("#modal-cancel").prop("value", "Restart");
  }

  self.showDetails();
}

HudManager.prototype.handleConsoleClose = function() {
  if (webReloadRequired) {
    qz_instance.SendGameCommand("web_reload");
  } 
  else {
    $("#qlhmPrompt").jqmHide();
  }  
}

/**
 * Hook Manager
 */
function HookManager(aProps) {
  readOnly(this, "name", "Quake Live Hook Manager");
  readOnly(this, "version", 0.3);
  readOnly(this, "debug", !!aProps.debug);
}

HookManager.prototype.init = function() {
  console.log("^2Initializing " + this.name + " v" + this.version);

  $ = aWin.jQuery;

  if (this.debug) {
    console.debug("^3DEBUG ENABLED.  Press F12 to open Firebug Lite.");
    // Firebug Lite (F12 to open)
    $("body").append("<script type='text/javascript' src='https://getfirebug.com/firebug-lite.js'>");
  }

  readOnly(this, "hud", new HudManager(this));
  storage.init(this.loadScripts.bind(this));
  setTimeout(this.versionCheck.bind(this), 5E3);
}

HookManager.prototype.versionCheck = function() {
  var self = this;
  $.ajax({
      url: VERSION_CHECK_URL
    , data: {currentVersion: self.version}
    , dataType: "jsonp"
  }).done(function(data) {
    if (data.new) {
      console.log("New version of " + self.name + " found: " + data.new.version);
      var out = "A new version (" + data.new.version + ") of " + self.name + " is available @ <a href='"
              + data.new.url + "' target='_blank'>" + data.new.url + "</a>.<br><br>You will need to manually update your "
              + "\"hook.js\" file, which is currently at version " + self.version + ".";
      self.hud.alert({
          title: self.name + " Update Available"
        , body: out
      });
    }
    else {
      console.log("On the latest " + self.name + " client release");
    }
  });
}

HookManager.prototype.loadScripts = function() {
  var self = this;

  // Fire off requests for each script
  $.each(storage.scripts.enabled, function(i, scriptID) {
    var script = storage.scripts.cache[scriptID];

    // TODO: re-enable loading from cache once expiration stuff is in place...
    var USE_CACHE = false;

    // Serve from cache?
    if (USE_CACHE && script) {
      console.log("^7Retrieving '^5" + script.headers.name[0] + "^7' (ID '^5" + scriptID + "^7') from cache");
      self.injectUserScript(script);
    }
    // ... or pull fresh data
    else {
      console.log("^7Attempting fresh retrieval of script with ID '^5" + scriptID + "^7'");
      self.fetchScript(scriptID);
    }
  });

  // User-specified scripts
  $.each(config.manual, function(i, scriptURL) {
    console.log("^7Attempting fresh retrieval of script with URL '^5" + scriptURL + "^7'");
    $.ajax({
      url: scriptURL
    , dataType: "jsonp"
    }).done(function(aData) {
      injectScript(";(function() {" + aData + "})();");
    });
  });
}

HookManager.prototype.fetchScript = function(aScriptID, aCB) {
  var self = this
    , handleScriptSuccess = this.handleScriptSuccess.bind(this)
    ;

  $.ajax({
      url: JSONP_PROXY_TEMPLATE.replace("{{id}}", aScriptID)
    , headers: {"Accept-Version": "~1"}
    , dataType: "jsonp"
  })
  .done(function(aData) {
    if (aCB) setTimeout(function() { aCB.call(null, aData); }, 0);
    handleScriptSuccess(aData);
  })
  .fail(self.handleScriptError.bind(self, aScriptID));
}

HookManager.prototype.handleScriptSuccess = function(aData) {
  console.log("^2Successfully retrieved script with ID '^5" + aData._meta.id + "^2' '^5" + aData.headers.name[0] + "^2'");
  this.addUserScript(aData);
}

HookManager.prototype.handleScriptError = function(aScriptID, jqXHR, settings, err) {
  console.log("^1Failed to retrieve script with ID '^5" + aScriptID + "^1' : ^7" + err);
}

HookManager.prototype.hasUserScript = function(aID) {
  return -1 != storage.scripts.available.indexOf(aID);
}

HookManager.prototype.addUserScript = function(aScript) {
  var id = aScript._meta.id;
  // Only add entries if this is a new script...
  if (!this.hasUserScript(id)) {
    storage.scripts.available.push(id);
    storage.scripts.enabled.push(id);
  }
  storage.scripts.cache[id] = aScript;
  storage.save();
  this.injectUserScript(storage.scripts.cache[id]);
}

HookManager.prototype.removeUserScript = function(aID) {
  var avIndex = storage.scripts.available.indexOf(aID)
    , enIndex = storage.scripts.enabled.indexOf(aID)
    , name
    ;

  if (-1 == avIndex) return false;
  name = storage.scripts.cache[aID].headers.name[0];
  storage.scripts.available.splice(avIndex, 1);

  if (-1 != enIndex) storage.scripts.enabled.splice(enIndex, 1);
  delete storage.scripts.cache[aID];

  storage.save();

  console.log("^7'^5" + name + "^7' has been removed, but you must restart QUAKE LIVE for the change to take effect.");

  return true;
}

HookManager.prototype.toggleUserScript = function(aID, aEnable) {
  // return true if web_reload is required to make the change take effect
  var enable = true === aEnable ? aEnable : false
    , enIndex = storage.scripts.enabled.indexOf(aID)
    , script = storage.scripts.cache[aID]
    , name
    ;

  if (!script) return false;
  name = script.headers.name[0];

  if (enable && -1 == enIndex) {
    storage.scripts.enabled.push(aID);
    storage.save();
    this.injectUserScript(script);
    console.log("^7'^5" + name + "^7' has been enabled and injected.  You might need to restarted QUAKE LIVE to get the expected behaviour.");
    return false;
  }
  else if (!enable && -1 != enIndex) {
    storage.scripts.enabled.splice(enIndex, 1);
    storage.save();
    console.log("^7'^5" + name + "^7' has been disabled, but you must restart QUAKE LIVE for the change to take effect.");
    return true;
  }
  return false;
}

HookManager.prototype.injectUserScript = function(aScript) {
  console.log("^7Loading userscript '^5" + aScript.headers.name[0] + "^7' (ID '^5" + aScript._meta.id + "^7')");
  injectScript(";(function() {" + aScript.content + "})();");
}

HookManager.prototype.getUserScript = function(aScriptID) {
  return storage.scripts.cache[aScriptID];
}

HookManager.prototype.getUserScriptSource = function(aScriptID) {
  var script = this.getUserScript(aScriptID);
  if (!script) return;
  return script.content;
}

// Make init available
var hm = new HookManager({debug: config.debug});
aWin.HOOK_MANAGER = {init: hm.init.bind(hm)};

})(window);
