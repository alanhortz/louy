/** Forme d'un dictionnaire : les mêmes clés que le modèle, chaque feuille étant un texte. */
export type Shape<T> = { readonly [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
