'use strict';

function computePlanPrice(features = {}, cfg) {
  let price = cfg.basePrice || 0;
  if (features.kitchenDisplay || features.tabs) price += cfg.addons?.restaurantFeatures || 0;
  if (features.memberships)    price += cfg.addons?.memberships    || 0;
  if (features.emailCampaigns) price += cfg.addons?.emailCampaigns || 0;
  if (features.discountCodes)  price += cfg.addons?.discountCodes  || 0;
  if (features.reservations)   price += cfg.addons?.reservations   || 0;
  if (features.hotel)          price += cfg.addons?.hotel          || 0;
  if (features.inventory)      price += cfg.addons?.inventory      || 0;
  return Math.round(price * 100) / 100;
}

module.exports = { computePlanPrice };
