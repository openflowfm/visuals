// milkdrop-preset-converter ships no types: the calls the bench and its tests make.
declare module 'milkdrop-preset-converter' {
  const converter: { convertPreset(text: string): Promise<any>; convertShader(hlsl: string): Promise<any> };
  export default converter;
}
