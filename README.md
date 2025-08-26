# 🛍️ E-commerce API Documentation

This project provides a RESTful API for managing users, products, reviews, orders, and addresses for an e-commerce platform.

## 🌐 Base URL
```
http://localhost:3000/api
```

---

## 🔐 Auth Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/auth/admin/login`         | Admin login |
| POST   | `/auth/customer/register`   | Customer registration |
| POST   | `/auth/customer/login`      | Customer login |
| GET    | `/auth/profile`             | Get current user profile |
| PUT    | `/auth/profile`             | Update user email |
| POST   | `/auth/logout`              | Logout (token removal on client side) |

---

## 🛍️ Product Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/products/meta/categories` | Get unique product categories |
| GET    | `/products/meta/types`      | Get product types |
| GET    | `/products/meta/styles`     | Get product styles |
| GET    | `/products/category/:category` | Get products by category |
| GET    | `/products/`                | Get all products (with filters) |
| GET    | `/products/:id`             | Get product by ID |
| POST   | `/products/`                | Add new product (Admin only) |
| PUT    | `/products/:id`             | Update product (Admin only) |
| DELETE | `/products/:id`             | Delete product (Admin only) |

---

## 🌟 Review Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/reviews/stats/summary` | Get review statistics (Admin only) |
| GET    | `/reviews/`              | Get all reviews |
| POST   | `/reviews/`              | Add a new review |
| GET    | `/reviews/:id`           | Get review by ID |
| PUT    | `/reviews/:id`           | Update review (Admin only) |
| DELETE | `/reviews/:id`           | Delete review (Admin only) |

---

## 📦 Order & Address Endpoints

### 🏠 Addresses

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/orders/addresses`       | Get user addresses |
| POST   | `/orders/addresses`       | Add new address |
| PUT    | `/orders/addresses/:id`   | Update address |
| DELETE | `/orders/addresses/:id`   | Delete address |

### 📦 Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/orders/stats/summary`   | Get order statistics (Admin only) |
| GET    | `/orders/`                | Get user orders (Admin: all orders) |
| POST   | `/orders/`                | Create new order |
| GET    | `/orders/:id`             | Get order by ID with items |
| PUT    | `/orders/:id/status`      | Update order status (Admin only) |

---

## 🧪 Testing with Postman

### 1. Login and Get Token
- Use the `POST /auth/customer/login` or `/auth/admin/login`
- Copy the returned token

### 2. Add Token to Requests
In **Postman**, go to `Authorization` tab of your request:
- Type: **Bearer Token**
- Paste your token in the input field

Or add manually in Headers:
```
Authorization: Bearer <your_token>
```

### 3. Send Requests
Now you can test any protected endpoint like creating orders, products, addresses, etc.

---

## ℹ️ Notes
- Protected endpoints require JWT token.
- Admin-only routes require token of a user with `"role": "admin"`.
- Replace IDs (`:id`, `:category`) with real values.

# 🛍️ E-commerce API Documentation with POST Examples

This project provides a RESTful API for managing users, products, reviews, orders, and addresses for an e-commerce platform.

## 🌐 Base URL
```
http://localhost:3000/api
```

---

## 🔐 Auth Endpoints

### 🔸 POST `/auth/admin/login`
```json
{
  "username": "adminUser",
  "password": "adminPassword"
}
```

### 🔸 POST `/auth/customer/register`
```json
{
  "username": "mostafa",
  "email": "mostafa@example.com",
  "password": "123456"
}
```

### 🔸 POST `/auth/customer/login`
```json
{
  "username": "mostafa",
  "password": "123456"
}
```

### 🔸 PUT `/auth/profile` (update email)
```json
{
  "email": "newemail@example.com"
}
```

---

## 🛍️ Product Endpoints

### 🔸 POST `/products/` (Admin only)
```json
{
  "name": "T-Shirt",
  "description": "High quality cotton",
  "price": 150,
  "discount": 10,
  "stars": 4,
  "category": "Clothing",
  "style": "Casual",
  "style2": "Summer",
  "type": "Topwear",
  "type2": "Shirt",
  "image_url": "https://example.com/tshirt.jpg",
  "stock_quantity": 100
}
```

---

## 🌟 Review Endpoints

### 🔸 POST `/reviews/`
```json
{
  "name": "Mostafa",
  "review": "Great quality and fast delivery!",
  "rating": 5
}
```

---

## 📦 Order & Address Endpoints

### 🏠 Addresses

### 🔸 POST `/orders/addresses`
```json
{
  "address": "123 Nile Street",
  "phone": "01123456789",
  "city": "Cairo",
  "is_default": true
}
```

### 📦 Orders

### 🔸 POST `/orders/`
```json
{
  "address_id": 1,
  "items": [
    {
      "product_id": 1,
      "quantity": 2
    },
    {
      "product_id": 2,
      "quantity": 1
    }
  ]
}
```

### 🔸 PUT `/orders/:id/status` (Admin only)
```json
{
  "status": "shipped",
  "payment_status": "paid"
}
```

---

## 🧪 How to Test in Postman

1. Login via `/auth/customer/login` or `/auth/admin/login` and copy the `token`.
2. In Postman, go to the `Authorization` tab.
3. Choose **Bearer Token** and paste the token.
4. Send any request from above.

---

## ℹ️ Notes
- All `POST` and `PUT` routes that are protected require a valid JWT token.
- Admin-only routes must use a token issued for an admin account.
