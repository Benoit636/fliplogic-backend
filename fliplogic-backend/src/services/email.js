import nodemailer from 'nodemailer';
import logger from '../config/logger.js';

// Configure email transporter (using SendGrid)
const transporter = nodemailer.createTransport({
  host: 'smtp.sendgrid.net',
  port: 587,
  auth: {
    user: 'apikey',
    pass: process.env.SENDGRID_API_KEY,
  },
});

/**
 * Send appraisal email to seller
 */
export async function sendSellerAppraisalEmail({ sellerEmail, dealerName, dealerEmail, appraisal }) {
  try {
    const totalInvestment = appraisal.acquisitionCost + appraisal.reconCost;
    const actualReconCost = appraisal.reconCost;

    const htmlTemplate = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #003d7a; color: white; padding: 20px; border-radius: 5px; }
            .section { margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #003d7a; }
            .value { font-size: 18px; font-weight: bold; color: #003d7a; }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #999; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Your Vehicle Appraisal</h1>
              <p>Thank you for considering ${dealerName} for your trade-in.</p>
            </div>

            <div class="section">
              <h3>Vehicle Details</h3>
              <p><strong>${appraisal.year} ${appraisal.make} ${appraisal.model}</strong></p>
              <p>Mileage: ${appraisal.mileage?.toLocaleString()} km</p>
            </div>

            <div class="section">
              <h3>How We Determined Your Fair Trade Value</h3>
              <p>We don't use outdated price guides. Instead, we analyzed comparable vehicles currently for sale in your area to determine what your vehicle is truly worth in today's market.</p>
              
              <p><strong>Your Market Value:</strong></p>
              <p class="value">$${appraisal.marketValue?.toLocaleString()}</p>
              
              <p>This is what a buyer would expect to pay if purchasing your vehicle privately or from a dealer.</p>
            </div>

            <div class="section">
              <h3>Our Trade Offer</h3>
              <p>We're offering <span class="value">$${appraisal.acquisitionCost?.toLocaleString()}</span> for your vehicle as a trade-in.</p>
              
              <p><strong>Here's why this is fair:</strong></p>
              <p>Your vehicle will need reconditioning to meet our dealership standards and consumer expectations:</p>
              <ul>
                <li>Detailing & inspection: Included</li>
                <li>Repairs & cosmetic touch-ups: ~$${actualReconCost?.toLocaleString()}</li>
                <li>Certification & paperwork: Included</li>
              </ul>
              
              <p>After accounting for:</p>
              <ul>
                <li>Current market value: $${appraisal.marketValue?.toLocaleString()}</li>
                <li>Our reconditioning investment: ~$${actualReconCost?.toLocaleString()}</li>
                <li>Dealer operating costs & profit margin: ~5%</li>
              </ul>
              
              <p><strong>Our trade offer of $${appraisal.acquisitionCost?.toLocaleString()} reflects a fair price that allows us to invest in your vehicle and offer it competitively to other buyers.</strong></p>
            </div>

            <div class="section">
              <h3>Next Steps</h3>
              <p>If you'd like to proceed with this trade-in offer, please reply to this email or call us.</p>
              <p><strong>Email:</strong> ${dealerEmail}</p>
            </div>

            <div class="footer">
              <p>This appraisal is valid for 7 days.</p>
              <p>© ${new Date().getFullYear()} ${dealerName}. All rights reserved.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const mailOptions = {
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@fliplogic.com',
      to: sellerEmail,
      subject: `Your Vehicle Appraisal - ${appraisal.year} ${appraisal.make} ${appraisal.model}`,
      html: htmlTemplate,
      replyTo: dealerEmail,
    };

    await transporter.sendMail(mailOptions);

    logger.info(`✅ Seller email sent to: ${sellerEmail}`);
    return true;
  } catch (error) {
    logger.error('Error sending seller email:', error);
    throw error;
  }
}

/**
 * Send welcome email to new user
 */
export async function sendWelcomeEmail({ email, displayName, dealerName }) {
  try {
    const htmlTemplate = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #003d7a; color: white; padding: 20px; border-radius: 5px; }
            .section { margin: 20px 0; padding: 15px; background: #f9f9f9; border-left: 4px solid #003d7a; }
            .cta { background: #003d7a; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to FlipLogic!</h1>
              <p>Hi ${displayName || 'there'},</p>
            </div>

            <div class="section">
              <p>Thank you for signing up for FlipLogic. You now have access to powerful vehicle appraisal tools that will help you make smarter deals, faster.</p>
            </div>

            <div class="section">
              <h3>Your 14-Day Free Trial</h3>
              <p>You have 14 days to explore FlipLogic at no cost. Run unlimited appraisals, analyze deals, and see how much time and money you can save.</p>
              <p><a href="https://app.fliplogic.com" class="cta">Start Your First Appraisal</a></p>
            </div>

            <div class="section">
              <h3>How It Works</h3>
              <ol>
                <li>Enter a vehicle VIN</li>
                <li>Assess the vehicle condition</li>
                <li>Get instant appraisal with market-based pricing</li>
                <li>List and flip faster, smarter</li>
              </ol>
            </div>

            <div class="section">
              <p>Questions? We're here to help. Reply to this email anytime.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const mailOptions = {
      from: process.env.SENDGRID_FROM_EMAIL || 'noreply@fliplogic.com',
      to: email,
      subject: 'Welcome to FlipLogic - Your 14-Day Free Trial is Ready',
      html: htmlTemplate,
    };

    await transporter.sendMail(mailOptions);

    logger.info(`✅ Welcome email sent to: ${email}`);
    return true;
  } catch (error) {
    logger.error('Error sending welcome email:', error);
    throw error;
  }
}
