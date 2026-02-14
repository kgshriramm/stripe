const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./db');
require('dotenv').config();

const app = express();
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

app.use(cors());
// Match the raw body to content type application/json
app.use(express.static('.'));

// Webhook requires raw body
app.post('/webhook', express.raw({ type: 'application/json' }), async (request, response) => {
    const sig = request.headers['stripe-signature'];

    let event;

    try {
        event = stripe.webhooks.constructEvent(request.body, sig, endpointSecret);
    } catch (err) {
        console.log(`Webhook Error: ${err.message}`);
        response.status(400).send(`Webhook Error: ${err.message}`);
        return;
    }

    // Handle the event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        console.log('Payment successful for session:', session.id);

        // Extract data
        const customerEmail = session.customer_details.email;
        const amountHtml = session.amount_total; // in cents
        const courseId = session.metadata ? session.metadata.course_id : 'unknown';

        // Enroll user (Mock Teachable API)
        await enrollUser(customerEmail, courseId);

        // Store in Database
        try {
            // Simple upsert user
            let userRes = await db.query('SELECT id FROM users WHERE email = $1', [customerEmail]);
            let userId;
            if (userRes.rows.length === 0) {
                const newUser = await db.query('INSERT INTO users (email) VALUES ($1) RETURNING id', [customerEmail]);
                userId = newUser.rows[0].id;
            } else {
                userId = userRes.rows[0].id;
            }

            // Record purchase
            await db.query('INSERT INTO purchases (user_id, course_id, stripe_session_id, amount) VALUES ($1, $2, $3, $4)',
                [userId, courseId, session.id, amountHtml]);

            console.log('Purchase recorded in database');

        } catch (dbErr) {
            console.error('Database error:', dbErr);
        }
    }

    // Return a 200 response to acknowledge receipt of the event
    response.send();
});

// Use JSON parser for other endpoints
app.use(express.json());

app.post('/create-checkout-session', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: 'Amazing Course',
                        },
                        unit_amount: 2000, // $20.00
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: 'http://localhost:3000/success.html',
            cancel_url: 'http://localhost:3000/cancel.html',
            metadata: {
                course_id: 'course_123'
            }
        });

        res.json({ url: session.url });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Mock Teachable API
async function enrollUser(email, courseId) {
    console.log(`[Mock Teachable API] User ${email} enrolled in course ${courseId}`);
    return Promise.resolve(true);
}

// Success and Cancel pages
app.get('/success.html', (req, res) => {
    res.send('<html><body><h1>Thanks for your order!</h1><p>Check your email for the course link.</p></body></html>');
});

app.get('/cancel.html', (req, res) => {
    res.send('<html><body><h1>Order canceled</h1><p>Maybe next time.</p></body></html>');
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
