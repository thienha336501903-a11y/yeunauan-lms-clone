import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { issueV5PlaybackLease } from "../utils/v5-playback-lease.js";

test("V5 playback lease is bounded to at most five minutes",()=>{
  const {privateKey}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});
  const jwk=privateKey.export({format:"jwk"});
  const prior=process.env.V5_PLAYBACK_PRIVATE_JWK;
  const priorMediaUrl=process.env.V5_MEDIA_PUBLIC_URL;
  process.env.V5_PLAYBACK_PRIVATE_JWK=JSON.stringify(jwk);
  process.env.V5_MEDIA_PUBLIC_URL="https://media.example.test";
  try{
    const before=Date.now();
    const lease=issueV5PlaybackLease({
      version:2,
      assetId:"asset-1",
      courseSlug:"course-1",
      objectKey:"private/test.mp4",
      mediaType:"video",
      mimeType:"video/mp4",
      filename:"test.mp4",
      bytes:123,
      userAgent:"test-agent",
      email:"student@example.com",
      ttlMs:60*60*1000,
      proofPublicJwk:{kty:"EC",crv:"P-256",x:"x",y:"y"}
    });
    assert.ok(lease.expiresAt-before<=5*60*1000+1000);
    assert.ok(lease.expiresAt-before>=60*1000);
  }finally{
    if(prior===undefined) delete process.env.V5_PLAYBACK_PRIVATE_JWK;
    else process.env.V5_PLAYBACK_PRIVATE_JWK=prior;
    if(priorMediaUrl===undefined) delete process.env.V5_MEDIA_PUBLIC_URL;
    else process.env.V5_MEDIA_PUBLIC_URL=priorMediaUrl;
  }
});
