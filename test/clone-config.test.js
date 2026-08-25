import test from "node:test";
import assert from "node:assert/strict";
import { cloneConfig } from "../utils/clone-config.js";

test("Clone Factory defaults preserve the current System B production URLs", () => {
  const config = cloneConfig({});
  assert.equal(config.systemId, "system-b");
  assert.equal(config.commercePublicUrl, "https://yeubep.shop");
  assert.equal(config.lmsPublicUrl, "https://hoc.yeubep.shop");
  assert.equal(config.v4PublicUrl, "https://v4.daubepnho.store");
  assert.equal(config.telegramClonerUrl, "https://reader.yeubep.shop");
});

test("Clone Factory accepts an isolated System C URL set", () => {
  const config = cloneConfig({
    SYSTEM_ID: "system-c",
    COMMERCE_PUBLIC_URL: "shop.example.com",
    LMS_PUBLIC_URL: "learn.example.com",
    V4_PUBLIC_URL: "player.example.com",
    TELEGRAM_CLONER_URL: "reader.example.com"
  });
  assert.equal(config.systemId, "system-c");
  assert.equal(config.commercePublicUrl, "https://shop.example.com");
  assert.equal(config.lmsPublicUrl, "https://learn.example.com");
  assert.equal(config.v4PublicUrl, "https://player.example.com");
  assert.equal(config.telegramClonerUrl, "https://reader.example.com");
});

test("Clone Factory rejects a non-HTTPS origin", () => {
  assert.throws(() => cloneConfig({ LMS_PUBLIC_URL: "http://learn.example.com" }), /clone_config_invalid_https_origin/);
});
