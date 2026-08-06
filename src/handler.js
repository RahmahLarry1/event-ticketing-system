// nodejs20.x comes with the AWS SDK v3 built in, so no npm install needed
// for these two packages.
const crypto = require("crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
} = require("@aws-sdk/lib-dynamodb");

// The "client" is our open phone line to DynamoDB. We create it once,
// outside the handler, so Lambda can reuse it across warm invocations
// instead of reconnecting on every single request.
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// This was set in lambda.tf as an environment variable — it's how the
// code knows which table to talk to without hardcoding the name.
const TABLE_NAME = process.env.TABLE_NAME;

exports.handler = async (event) => {
  console.log("Received event:", JSON.stringify(event));

  // routeKey looks like "GET /events" or "POST /register" — API Gateway
  // sets this for us based on which route matched the request.
  const routeKey = event.routeKey;

  try {
    if (routeKey === "GET /events") {
      return await listEvents();
    }

    if (routeKey === "POST /register") {
      return await registerForEvent(event);
    }

    if (routeKey === "GET /registrations/{email}") {
      return await getRegistrationsByEmail(event);
    }

    if (routeKey === "DELETE /registration/{id}") {
      return await cancelRegistration(event);
    }

    // No matching route yet — Phase 2 will add more branches here.
    return respond(404, { error: `No handler for route: ${routeKey}` });
  } catch (err) {
    console.error("Error handling request:", err);
    return respond(500, { error: "Internal server error" });
  }
};

async function listEvents() {
  // Scan reads every item in the table, then we filter to only the ones
  // whose PK starts with "EVENT#" — that's how we separate events from
  // registrations, since they live in the same table.
  const result = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "begins_with(PK, :prefix)",
      ExpressionAttributeValues: { ":prefix": "EVENT#" },
    })
  );

  // Reshape each DynamoDB item into cleaner JSON for the API response —
  // callers of this API shouldn't need to know about PK/SK internals.
  const events = (result.Items || []).map((item) => ({
    eventId: item.PK.replace("EVENT#", ""),
    eventName: item.eventName,
    eventDate: item.eventDate,
    capacity: item.capacity,
    status: item.status,
  }));

  return respond(200, { events });
}

async function registerForEvent(event) {
  // event.body arrives as a JSON string — parse it into a real object.
  // Wrapped in try/catch because if the caller sends broken JSON,
  // JSON.parse throws, and we want a clean 400 error, not a crash.
  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { error: "Request body must be valid JSON" });
  }

  const { name, email, eventId, source } = data;

  // --- Validation: reject bad input before it ever touches DynamoDB ---
  if (!name || typeof name !== "string" || !name.trim()) {
    return respond(400, { error: "Name is required" });
  }
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return respond(400, { error: "A valid email is required" });
  }
  if (!eventId || typeof eventId !== "string") {
    return respond(400, { error: "eventId is required" });
  }

  // --- Confirm the event actually exists, and isn't full ---
  const eventResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `EVENT#${eventId}`, SK: `EVENT#${eventId}` },
    })
  );

  if (!eventResult.Item) {
    return respond(404, { error: `No event found with id: ${eventId}` });
  }

  const capacity = eventResult.Item.capacity || 0;

  const existingRegs = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "eventId = :eventId AND begins_with(PK, :prefix)",
      ExpressionAttributeValues: {
        ":eventId": eventId,
        ":prefix": "REGISTRATION#",
      },
    })
  );
  const currentCount = (existingRegs.Items || []).length;

  if (currentCount >= capacity) {
    return respond(409, { error: "This event is at full capacity" });
  }

  // --- Write the registration ---
  const registrationId = crypto.randomUUID();
  const registeredAt = new Date().toISOString();

  const registration = {
    PK: `REGISTRATION#${registrationId}`,
    SK: `REGISTRATION#${registrationId}`,
    registrationId,
    eventId,
    name: name || null,
    email,
    source: source || "direct",
    registeredAt,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: registration,
    })
  );

  return respond(201, {
    message: "Registration successful",
    registration: {
      registrationId,
      eventId,
      name: registration.name,
      email,
      registeredAt,
    },
  });
}

async function getRegistrationsByEmail(event) {
  // API Gateway captures the {email} part of the URL and puts it here.
  // decodeURIComponent handles the case where the email arrives URL-encoded
  // (e.g. "%40" instead of "@").
  const email = decodeURIComponent(event.pathParameters?.email || "");

  if (!email) {
    return respond(400, { error: "Email is required in the URL path" });
  }

  // This is a Query, not a Scan — much more efficient. It only reads
  // items where email matches exactly, using the EmailIndex GSI we
  // created back in Phase 1, instead of reading the whole table.
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "EmailIndex",
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: { ":email": email },
    })
  );

  const registrations = (result.Items || []).map((item) => ({
    registrationId: item.registrationId,
    eventId: item.eventId,
    name: item.name,
    registeredAt: item.registeredAt,
  }));

  return respond(200, { email, registrations });
}

async function cancelRegistration(event) {
  const id = event.pathParameters?.id;

  if (!id) {
    return respond(400, { error: "Registration id is required in the URL path" });
  }

  const key = { PK: `REGISTRATION#${id}`, SK: `REGISTRATION#${id}` };

  // Check it exists first — deleting a non-existent item wouldn't error
  // in DynamoDB (Delete is silently OK either way), so without this check
  // we'd tell the caller "cancelled!" even for a made-up id. Checking
  // first gives an honest 404 instead.
  const existing = await docClient.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));

  if (!existing.Item) {
    return respond(404, { error: `No registration found with id: ${id}` });
  }

  await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: key }));

  return respond(200, { message: "Registration cancelled", registrationId: id });
}

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}