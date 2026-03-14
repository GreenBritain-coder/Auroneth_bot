# Testing Guide: New User vs Existing User

## How to Test as a New User

When you first start the bot with `/start`, it will prompt you to enter a secret phrase. To test this as a new user:

### Option 1: Delete Your User Account (Recommended)
1. Get your Telegram User ID:
   - Start a chat with `@userinfobot` on Telegram
   - It will show your User ID (a number like `123456789`)

2. Delete your user from the database:
   ```bash
   cd telegram-bot-service
   py -3.12 check_user_status.py YOUR_USER_ID --delete
   ```
   Example:
   ```bash
   py -3.12 check_user_status.py 123456789 --delete
   ```

3. Now when you type `/start` in the bot, it will prompt you to enter a secret phrase.

### Option 2: Use a Different Telegram Account
- Use a different Telegram account that hasn't used the bot before
- Type `/start` in the bot
- You'll be prompted to enter a secret phrase

## How to Check Your User Status

Check if you're registered as a user:

```bash
cd telegram-bot-service
py -3.12 check_user_status.py YOUR_USER_ID
```

List all users in the database:

```bash
py -3.12 check_user_status.py --list
```

## What Happens

### New User Flow:
1. User types `/start`
2. Bot checks if user exists in database
3. If not found → Bot asks: "Please enter your secret phrase to continue"
4. User enters their secret phrase
5. Bot validates (3-50 characters)
6. Bot saves the secret phrase
7. Bot shows welcome message with menu

### Existing User Flow:
1. User types `/start`
2. Bot checks if user exists in database
3. If found → Bot immediately shows welcome message (no prompt)

## Commands

- `py -3.12 check_user_status.py <user_id>` - Check if user exists
- `py -3.12 check_user_status.py <user_id> --delete` - Delete user (to test as new user)
- `py -3.12 check_user_status.py --list` - List all users

