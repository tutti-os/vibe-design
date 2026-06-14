import type { DesignTweakDefaults } from './tweak-defaults';

export function buildDesignRuntimeBridge(entryPath: string, tweakSource: DesignTweakDefaults): string {
  const metadata = escapeJsonForScript(
    JSON.stringify({
      entryPath,
      sourcePath: tweakSource.sourcePath,
      tweakDefaults: tweakSource.defaults,
    }),
  );

  return `<script data-vd-design-runtime-bridge>
(function () {
  var metadata = ${metadata};
  var currentTweaks = Object.assign({}, metadata.tweakDefaults || {});
  var listeners = [];

  function cloneTweaks() {
    return Object.assign({}, currentTweaks);
  }

  function notify() {
    var snapshot = cloneTweaks();
    listeners.slice().forEach(function (listener) {
      listener(snapshot);
    });
  }

  function applyEdits(edits, changedKey) {
    if (!edits || typeof edits !== 'object' || Array.isArray(edits)) return;
    currentTweaks = Object.assign({}, currentTweaks, edits);
    notify();
    if (changedKey) {
      window.parent.postMessage({
        type: 'vd-design-tweak-changed',
        key: changedKey,
        value: currentTweaks[changedKey],
        tweaks: cloneTweaks(),
        entryPath: metadata.entryPath,
        sourcePath: metadata.sourcePath
      }, '*');
    }
  }

  function setTweak(keyOrEdits, value) {
    if (typeof keyOrEdits === 'string') {
      var edit = {};
      edit[keyOrEdits] = value;
      applyEdits(edit, keyOrEdits);
      return;
    }
    applyEdits(keyOrEdits, null);
  }

  function resetTweaks(nextDefaults) {
    currentTweaks = Object.assign({}, nextDefaults && typeof nextDefaults === 'object' ? nextDefaults : metadata.tweakDefaults || {});
    notify();
  }

  function useVDTweaks(defaults) {
    if (window.React && defaults && typeof defaults === 'object' && !Array.isArray(defaults)) {
      currentTweaks = Object.assign({}, defaults, currentTweaks);
    }
    var state = window.React.useState(cloneTweaks());
    var values = state[0];
    var setValues = state[1];
    window.React.useEffect(function () {
      listeners.push(setValues);
      return function () {
        listeners = listeners.filter(function (listener) {
          return listener !== setValues;
        });
      };
    }, []);
    return [values, setTweak];
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'vd-design-tweak-set' && typeof data.key === 'string') {
      var edit = {};
      edit[data.key] = data.value;
      applyEdits(edit, data.key);
      return;
    }
    if (data.type === 'vd-design-tweaks-reset') {
      resetTweaks(data.tweaks);
    }
  });

  window.VibeDesignRuntime = {
    useVDTweaks: useVDTweaks,
    setTweak: setTweak,
    resetTweaks: resetTweaks
  };
  window.useVDTweaks = useVDTweaks;

  window.parent.postMessage({
    type: 'vd-design-runtime-ready',
    entryPath: metadata.entryPath,
    sourcePath: metadata.sourcePath,
    tweakDefaults: cloneTweaks()
  }, '*');
})();
</script>`;
}

function escapeJsonForScript(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
