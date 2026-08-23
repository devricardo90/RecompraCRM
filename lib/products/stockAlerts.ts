export type StockAlertProduct = {
  id: number;
  currentStock: number;
  minimumStock: number;
};

export function isLowStock(product: StockAlertProduct) {
  return product.currentStock <= product.minimumStock;
}

export function compareStockAlertUrgency(left: StockAlertProduct, right: StockAlertProduct) {
  const deficitDifference =
    left.currentStock - left.minimumStock - (right.currentStock - right.minimumStock);

  return deficitDifference || left.id - right.id;
}

export function getStockAlerts<T extends StockAlertProduct>(products: T[]) {
  return products.filter(isLowStock).sort(compareStockAlertUrgency);
}
