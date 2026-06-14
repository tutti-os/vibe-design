import { describe, expect, it } from 'vitest';
import {
  extractDesignTweakDefaults,
  replaceDesignTweakDefaults,
  type DesignTweakSourceFile,
} from './tweak-defaults';

const sourceFile: DesignTweakSourceFile = {
  name: 'app.jsx',
  path: 'app.jsx',
  mime: 'text/javascript',
  contents: `const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "primaryColor": "#F26B3F",
  "fontSize": 16,
  "dark": false
}/*EDITMODE-END*/;`,
};

describe('design tweak defaults', () => {
  it('extracts strict JSON defaults and remembers the source file path', () => {
    expect(extractDesignTweakDefaults([sourceFile])).toEqual({
      sourcePath: 'app.jsx',
      defaults: {
        primaryColor: '#F26B3F',
        fontSize: 16,
        dark: false,
      },
    });
  });

  it('ignores invalid JSON marker payloads without throwing', () => {
    expect(
      extractDesignTweakDefaults([
        {
          ...sourceFile,
          contents: 'const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{ primaryColor: "#F26B3F" }/*EDITMODE-END*/;',
        },
      ]),
    ).toBeNull();
  });

  it('replaces only the marker payload with stable pretty JSON', () => {
    const next = replaceDesignTweakDefaults(sourceFile.contents ?? '', {
      primaryColor: '#111111',
      fontSize: 18,
      dark: true,
    });

    expect(next).toContain('const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{');
    expect(next).toContain('  "primaryColor": "#111111",');
    expect(next).toContain('  "fontSize": 18,');
    expect(next).toContain('  "dark": true');
    expect(next).toContain('}/*EDITMODE-END*/;');
  });

  it('returns null when replacing a source without tweak markers', () => {
    expect(replaceDesignTweakDefaults('const value = 1;', { value: 2 })).toBeNull();
  });
});
