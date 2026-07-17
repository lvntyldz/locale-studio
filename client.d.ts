export interface I18nInspectorOptions {
  editorPort?: number;
  pingPort?: number;
}

export declare const devtoolsPostProcessor: {
  type: string;
  name: string;
  process: (value: string, key: string | string[], options: any, translator: any) => string;
};

export declare function initI18nInspector(options?: I18nInspectorOptions): () => void;
