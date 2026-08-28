import https from "node:https";

https.get("https://status.example.invalid/health", (response) => {
  console.log(response.statusCode);
});
