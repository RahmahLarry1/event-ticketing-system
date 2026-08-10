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
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");

const snsClient = new SNSClient({});
const TOPIC_ARN = process.env.SNS_TOPIC_ARN;

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

    return respond(404, { error: `No handler for route: ${routeKey}` });
  } catch (err) {
    console.error("Error handling request:", err);
    return respond(500, { error: "Internal server error" });
  }
};

async function listEvents() {
  const result = await docClient.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "begins_with(PK, :prefix)",
      ExpressionAttributeValues: { ":prefix": "EVENT#" },
    })
  );

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
  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return respond(400, { error: "Request body must be valid JSON" });
  }

  const { name, email, eventId, source } = data;

  if (!name || typeof name !== "string" || !name.trim()) {
    return respond(400, { error: "Name is required" });
  }
  if (!email || typeof email !== "string" || !email.includes("@")) {
    return respond(400, { error: "A valid email is required" });
  }
  if (!eventId || typeof eventId !== "string") {
    return respond(400, { error: "eventId is required" });
  }

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
  // Instead of rejecting outright when full, we mark the registration as
  // waitlisted — the record still gets saved, just with a different status.
  const status = currentCount >= capacity ? "waitlisted" : "confirmed";

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
    status,
    registeredAt,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: registration,
    })
  );

  // Notify via SNS — wrapped in its own try/catch so that if SNS has a
  // problem, the registration itself still succeeds.
  if (TOPIC_ARN) {
    try {
      const subject =
        status === "waitlisted" ? "You're on the waitlist" : "Registration confirmed";
      const message =
        status === "waitlisted"
          ? `Hi ${registration.name || "there"}, ${eventResult.Item.eventName} is currently full. You've been added to the waitlist and will be notified if a spot opens up.`
          : `Hi ${registration.name || "there"}, your registration for ${eventResult.Item.eventName} is confirmed. See you there!`;

      await snsClient.send(
        new PublishCommand({
          TopicArn: TOPIC_ARN,
          Subject: subject,
          Message: message,
        })
      );
    } catch (snsErr) {
      console.error("SNS publish failed:", snsErr);
    }
  }

  return respond(status === "waitlisted" ? 200 : 201, {
    message:
      status === "waitlisted"
        ? "Event is full — you've been added to the waitlist"
        : "Registration successful",
    registration: {
      registrationId,
      eventId,
      name: registration.name,
      email,
      status,
      registeredAt,
    },
  });
}

async function getRegistrationsByEmail(event) {
  const email = decodeURIComponent(event.pathParameters?.email || "");

  if (!email) {
    return respond(400, { error: "Email is required in the URL path" });
  }

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