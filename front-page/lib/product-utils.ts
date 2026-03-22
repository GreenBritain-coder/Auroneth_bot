import { IProduct } from './models';

export function getProductPrice(product: IProduct | Record<string, unknown>): number {
  const base = (product as IProduct).base_price ?? (product as Record<string, unknown>).base_price;
  const legacy = (product as IProduct).price ?? (product as Record<string, unknown>).price;
  return (base as number) ?? (legacy as number) ?? 0;
}
