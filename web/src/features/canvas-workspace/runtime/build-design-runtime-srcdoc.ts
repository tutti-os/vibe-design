import { buildPreviewSrcdoc } from './build-preview-srcdoc';
import { buildDesignRuntimeBridge } from './design-runtime-bridge';
import { extractDesignTweakDefaults } from './tweak-defaults';

export interface BuildDesignRuntimeSrcdocFile {
  name: string;
  path: string;
  contents?: string;
  mime: string;
  url?: string;
}

export interface BuildDesignRuntimeSrcdocOptions {
  entryFile: BuildDesignRuntimeSrcdocFile;
  files: BuildDesignRuntimeSrcdocFile[];
  editBridge: boolean;
  sizeBridge?: boolean;
  commentBridge?: boolean;
  snapshotBridge?: boolean;
}

export function buildDesignRuntimeSrcdoc(options: BuildDesignRuntimeSrcdocOptions): string {
  const entryHtml = options.entryFile.contents ?? '';
  const tweakSource = extractDesignTweakDefaults(options.files);
  const inlinedHtml = injectDesignRuntimeBridge(
    rewriteSameProjectResourceUrls(
      inlineSameProjectScripts(entryHtml, options.entryFile, options.files),
      options.entryFile,
      options.files,
    ),
    options.entryFile.path,
    tweakSource,
  );

  return buildPreviewSrcdoc(inlinedHtml, {
    editBridge: options.editBridge,
    sizeBridge: options.sizeBridge,
    navigationBasePath: options.entryFile.path,
    commentBridge: options.commentBridge,
    snapshotBridge: options.snapshotBridge,
  });
}

function rewriteSameProjectResourceUrls(
  html: string,
  entryFile: BuildDesignRuntimeSrcdocFile,
  files: BuildDesignRuntimeSrcdocFile[],
): string {
  if (typeof DOMParser === 'undefined') {
    return html;
  }

  const parsedDocument = new DOMParser().parseFromString(html, 'text/html');
  const filesByPath = buildFileLookup(files);
  let didChangeResources = false;

  const rewriteAttribute = (element: Element, attribute: string) => {
    const source = element.getAttribute(attribute);
    if (!source || !isSameProjectRelativeResourceSource(source)) {
      return;
    }

    const resolvedPath = resolveProjectRelativePath(entryFile.path, source);
    const sourceFile = filesByPath.get(resolvedPath);
    if (!sourceFile?.url) {
      return;
    }

    element.setAttribute(attribute, sourceFile.url);
    didChangeResources = true;
  };

  Array.from(parsedDocument.querySelectorAll('[src]')).forEach((element) => {
    if (element.localName.toLowerCase() === 'script') {
      return;
    }

    rewriteAttribute(element, 'src');
  });
  Array.from(parsedDocument.querySelectorAll('[poster]')).forEach((element) => rewriteAttribute(element, 'poster'));
  Array.from(parsedDocument.querySelectorAll('link[href]')).forEach((element) => rewriteAttribute(element, 'href'));

  if (!didChangeResources) {
    return html;
  }

  if (!isFullHtmlDocument(html)) {
    return parsedDocument.body.innerHTML;
  }

  return `${doctypeForDocument(html)}${parsedDocument.documentElement.outerHTML}`;
}

function injectDesignRuntimeBridge(
  html: string,
  entryPath: string,
  tweakSource: ReturnType<typeof extractDesignTweakDefaults>,
): string {
  if (!tweakSource) {
    return html;
  }

  const bridge = buildDesignRuntimeBridge(entryPath, tweakSource);
  const firstInlinedScriptIndex = html.search(/<script\b[^>]*\bdata-vd-source=/i);
  if (firstInlinedScriptIndex >= 0) {
    return `${html.slice(0, firstInlinedScriptIndex)}${bridge}${html.slice(firstInlinedScriptIndex)}`;
  }

  return html.includes('</body>') ? html.replace('</body>', () => `${bridge}</body>`) : `${html}${bridge}`;
}

function inlineSameProjectScripts(
  html: string,
  entryFile: BuildDesignRuntimeSrcdocFile,
  files: BuildDesignRuntimeSrcdocFile[],
): string {
  if (typeof DOMParser === 'undefined') {
    return html;
  }

  const parsedDocument = new DOMParser().parseFromString(html, 'text/html');
  const filesByPath = buildFileLookup(files);
  let didChangeScripts = false;

  Array.from(parsedDocument.querySelectorAll('script[src]')).forEach((script) => {
    const source = script.getAttribute('src');
    if (!source || !isSameProjectRelativeScriptSource(source)) {
      return;
    }

    const resolvedPath = resolveProjectRelativePath(entryFile.path, source);
    const sourceFile = filesByPath.get(resolvedPath);

    if (!sourceFile || sourceFile.contents === undefined) {
      script.setAttribute('data-vd-missing-source', 'true');
      didChangeScripts = true;
      return;
    }

    script.removeAttribute('src');
    script.setAttribute('data-vd-source', resolvedPath);
    script.textContent = escapeClosingScriptTags(sourceFile.contents);
    didChangeScripts = true;
  });

  if (!didChangeScripts) {
    return html;
  }

  if (!isFullHtmlDocument(html)) {
    return parsedDocument.body.innerHTML;
  }

  return `${doctypeForDocument(html)}${parsedDocument.documentElement.outerHTML}`;
}

function isFullHtmlDocument(html: string): boolean {
  const head = html.trimStart().slice(0, 64).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}

function buildFileLookup(files: BuildDesignRuntimeSrcdocFile[]): Map<string, BuildDesignRuntimeSrcdocFile> {
  const lookup = new Map<string, BuildDesignRuntimeSrcdocFile>();

  files.forEach((file) => {
    lookup.set(normalizeProjectPath(file.path), file);
    lookup.set(normalizeProjectPath(file.name), file);
    lookup.set(normalizeProjectPath(`assets/${file.name}`), file);
  });

  return lookup;
}

function isSameProjectRelativeScriptSource(source: string): boolean {
  return isSameProjectRelativeResourceSource(source);
}

function isSameProjectRelativeResourceSource(source: string): boolean {
  const trimmedSource = source.trim();

  if (
    trimmedSource.startsWith('/') ||
    trimmedSource.startsWith('#') ||
    trimmedSource.includes('\\') ||
    hasUriScheme(trimmedSource)
  ) {
    return false;
  }

  const sourcePath = stripQueryAndFragment(trimmedSource);

  return sourcePath.length > 0 && sourcePath.split('/').every((segment) => segment !== '..');
}

function hasUriScheme(source: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(source);
}

function resolveProjectRelativePath(entryPath: string, source: string): string {
  const entryDirectory = normalizeProjectPath(entryPath).split('/').slice(0, -1);
  const sourceSegments = stripQueryAndFragment(source.trim())
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');

  return normalizeProjectPath([...entryDirectory, ...sourceSegments].join('/'));
}

function stripQueryAndFragment(source: string): string {
  const queryIndex = source.indexOf('?');
  const fragmentIndex = source.indexOf('#');
  const cutIndexes = [queryIndex, fragmentIndex].filter((index) => index >= 0);
  const cutIndex = cutIndexes.length > 0 ? Math.min(...cutIndexes) : source.length;

  return source.slice(0, cutIndex);
}

function normalizeProjectPath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+/g, '/');
}

function escapeClosingScriptTags(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script');
}

function doctypeForDocument(documentHtml: string): string {
  return documentHtml.trimStart().toLowerCase().startsWith('<!doctype') ? '<!doctype html>' : '';
}
