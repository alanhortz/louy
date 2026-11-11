/**
 * Garde-fou de compatibilité — volontairement écrit en ES5.
 *
 * Un navigateur trop ancien ne sait même pas lire le code de l'application :
 * il afficherait une page noire sans explication. Ce script, injecté tel quel
 * dans index.html, s'exécute partout ; s'il constate que l'application ne
 * pourra pas démarrer, il affiche quelle version installer.
 *
 * `__SUPPORT__` est remplacé à la construction par la table de compatibilité.
 */
(function (support) {
  function canRunApplication() {
    try {
      if (!('noModule' in document.createElement('script'))) return false;
      // syntaxe ES2022 utilisée par le code de l'application
      new Function('class A { #p = 1; static s = this; } var o = {}; return o?.a ?? 1n;');
      return typeof Promise.allSettled === 'function' && typeof globalThis === 'object';
    } catch (error) {
      return false;
    }
  }

  function identify() {
    var agent = navigator.userAgent;
    if (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1) return support.minimum[0];
    for (var k = 0; k < support.minimum.length; k++) {
      if (new RegExp(support.minimum[k].pattern).test(agent)) return support.minimum[k];
    }
    return null;
  }

  function element(tag, text) {
    var node = document.createElement(tag);
    node.appendChild(document.createTextNode(text));
    return node;
  }

  if (canRunApplication()) return;
  window.__louyUnsupported = true;

  var host = document.getElementById('boot-notice');
  var mine = identify();
  host.appendChild(element('h1', support.title));
  host.appendChild(element('p', support.intro));
  if (mine) {
    host.appendChild(element('p', 'Version requise pour ' + mine.name + ' : ' + mine.version + ' ou ultérieure.'));
    host.appendChild(element('p', mine.hint));
  }
  var list = document.createElement('ul');
  for (var k = 0; k < support.minimum.length; k++) {
    list.appendChild(element('li', support.minimum[k].name + ' ' + support.minimum[k].version + ' ou ultérieur'));
  }
  host.appendChild(list);
  host.hidden = false;
})(__SUPPORT__);
