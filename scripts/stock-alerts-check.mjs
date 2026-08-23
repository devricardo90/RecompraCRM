import { strict as assert } from "node:assert";

import {
  compareStockAlertUrgency,
  getStockAlerts,
  isLowStock,
} from "../lib/products/stockAlerts.ts";

const products = [
  { id: 40, currentStock: 12, minimumStock: 10 },
  { id: 20, currentStock: 7, minimumStock: 10 },
  { id: 12, currentStock: 2, minimumStock: 5 },
  { id: 10, currentStock: 3, minimumStock: 5 },
  { id: 30, currentStock: 5, minimumStock: 5 },
];

assert.equal(isLowStock(products[2]), true, "below-minimum product was not an alert");
assert.equal(isLowStock(products[4]), true, "equal-minimum product was not an alert");
assert.equal(isLowStock(products[0]), false, "above-minimum product was an alert");
assert.deepEqual(
  getStockAlerts(products).map(({ id }) => id),
  [12, 20, 10, 30],
  "alerts were not ordered by deficit and then id",
);
assert.equal(compareStockAlertUrgency(products[1], products[2]), 8, "equal deficits did not use the id tiebreak");
assert.equal(getStockAlerts(products).length, 4, "alert count did not match the canonical predicate");

console.log("Stock alert projection tests: PASS");
