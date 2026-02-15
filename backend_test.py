#!/usr/bin/env python3
"""
SafeGuard Backend API Testing Suite
Tests authentication endpoints and core functionality
"""

import requests
import json
import jwt
import sys
from datetime import datetime
import time

# Configuration
BASE_URL = "https://app-rescue-44.preview.emergentagent.com/api"
JWT_SECRET = 'safeguard-secret-key-2025'  # From backend code
JWT_ALGORITHM = 'HS256'

class SafeGuardTester:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        })
        self.test_results = []
        self.auth_token = None
        self.test_user_id = None
        
    def log_test(self, test_name, success, message, details=None):
        """Log test results"""
        result = {
            'test': test_name,
            'success': success,
            'message': message,
            'timestamp': datetime.now().isoformat(),
            'details': details or {}
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name} - {message}")
        if details and not success:
            print(f"   Details: {details}")
    
    def test_user_registration(self):
        """Test POST /api/auth/register"""
        print("\n=== Testing User Registration ===")
        
        # Test data as specified in review request
        test_data = {
            "email": "newuser@test.com",
            "password": "TestPass123!",
            "confirm_password": "TestPass123!",
            "full_name": "New Test User",
            "phone": "5551234567",
            "role": "civil"
        }
        
        try:
            response = self.session.post(f"{BASE_URL}/auth/register", json=test_data)
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ['token', 'user_id', 'email', 'role']
                
                if all(field in data for field in required_fields):
                    self.auth_token = data['token']
                    self.test_user_id = data['user_id']
                    
                    # Verify token structure
                    try:
                        decoded = jwt.decode(data['token'], JWT_SECRET, algorithms=[JWT_ALGORITHM])
                        token_valid = all(key in decoded for key in ['user_id', 'email', 'role', 'exp'])
                        
                        if token_valid:
                            self.log_test("User Registration", True, 
                                        f"Successfully registered user with valid JWT token", 
                                        {"user_id": data['user_id'], "email": data['email'], "role": data['role']})
                        else:
                            self.log_test("User Registration", False, 
                                        "Registration successful but JWT token missing required fields",
                                        {"token_fields": list(decoded.keys())})
                    except jwt.InvalidTokenError as e:
                        self.log_test("User Registration", False, 
                                    "Registration successful but JWT token is invalid",
                                    {"jwt_error": str(e)})
                else:
                    missing = [f for f in required_fields if f not in data]
                    self.log_test("User Registration", False, 
                                f"Registration response missing required fields: {missing}",
                                {"response": data})
            else:
                self.log_test("User Registration", False, 
                            f"Registration failed with status {response.status_code}",
                            {"response": response.text})
                
        except requests.exceptions.RequestException as e:
            self.log_test("User Registration", False, 
                        f"Network error during registration: {str(e)}")
    
    def test_user_login(self):
        """Test POST /api/auth/login"""
        print("\n=== Testing User Login ===")
        
        login_data = {
            "email": "newuser@test.com",
            "password": "TestPass123!"
        }
        
        try:
            response = self.session.post(f"{BASE_URL}/auth/login", json=login_data)
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ['token', 'user_id', 'email', 'role']
                
                if all(field in data for field in required_fields):
                    # Verify JWT token
                    try:
                        decoded = jwt.decode(data['token'], JWT_SECRET, algorithms=[JWT_ALGORITHM])
                        
                        # Check if token contains expected user data
                        if (decoded.get('email') == login_data['email'] and 
                            decoded.get('role') == 'civil' and
                            decoded.get('user_id') == self.test_user_id):
                            
                            self.log_test("User Login", True, 
                                        "Successfully logged in with valid JWT token and correct user data",
                                        {"user_id": data['user_id'], "email": data['email'], "role": data['role']})
                        else:
                            self.log_test("User Login", False, 
                                        "Login successful but JWT token contains incorrect user data",
                                        {"expected_email": login_data['email'], "token_email": decoded.get('email')})
                    except jwt.InvalidTokenError as e:
                        self.log_test("User Login", False, 
                                    "Login successful but JWT token is invalid",
                                    {"jwt_error": str(e)})
                else:
                    missing = [f for f in required_fields if f not in data]
                    self.log_test("User Login", False, 
                                f"Login response missing required fields: {missing}",
                                {"response": data})
            else:
                self.log_test("User Login", False, 
                            f"Login failed with status {response.status_code}",
                            {"response": response.text})
                
        except requests.exceptions.RequestException as e:
            self.log_test("User Login", False, 
                        f"Network error during login: {str(e)}")
    
    def test_invalid_credentials(self):
        """Test that invalid credentials return 401"""
        print("\n=== Testing Invalid Credentials ===")
        
        # Test wrong password
        invalid_data = {
            "email": "newuser@test.com",
            "password": "WrongPassword123!"
        }
        
        try:
            response = self.session.post(f"{BASE_URL}/auth/login", json=invalid_data)
            
            if response.status_code == 401:
                self.log_test("Invalid Credentials - Wrong Password", True, 
                            "Correctly returned 401 for invalid password")
            else:
                self.log_test("Invalid Credentials - Wrong Password", False, 
                            f"Expected 401 but got {response.status_code}",
                            {"response": response.text})
        except requests.exceptions.RequestException as e:
            self.log_test("Invalid Credentials - Wrong Password", False, 
                        f"Network error: {str(e)}")
        
        # Test non-existent user
        invalid_data = {
            "email": "nonexistent@test.com",
            "password": "TestPass123!"
        }
        
        try:
            response = self.session.post(f"{BASE_URL}/auth/login", json=invalid_data)
            
            if response.status_code == 401:
                self.log_test("Invalid Credentials - Non-existent User", True, 
                            "Correctly returned 401 for non-existent user")
            else:
                self.log_test("Invalid Credentials - Non-existent User", False, 
                            f"Expected 401 but got {response.status_code}",
                            {"response": response.text})
        except requests.exceptions.RequestException as e:
            self.log_test("Invalid Credentials - Non-existent User", False, 
                        f"Network error: {str(e)}")
    
    def test_jwt_token_validation(self):
        """Test JWT token validation and structure"""
        print("\n=== Testing JWT Token Validation ===")
        
        if not self.auth_token:
            self.log_test("JWT Token Validation", False, 
                        "No auth token available from previous tests")
            return
        
        try:
            # Decode and validate token
            decoded = jwt.decode(self.auth_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            
            # Check required fields
            required_fields = ['user_id', 'email', 'role', 'exp']
            missing_fields = [f for f in required_fields if f not in decoded]
            
            if not missing_fields:
                # Check expiration
                exp_time = datetime.fromtimestamp(decoded['exp'])
                if exp_time > datetime.now():
                    self.log_test("JWT Token Validation", True, 
                                "JWT token is valid and properly structured",
                                {"expires_at": exp_time.isoformat(), "user_id": decoded['user_id']})
                else:
                    self.log_test("JWT Token Validation", False, 
                                "JWT token is expired",
                                {"expired_at": exp_time.isoformat()})
            else:
                self.log_test("JWT Token Validation", False, 
                            f"JWT token missing required fields: {missing_fields}",
                            {"token_fields": list(decoded.keys())})
                
        except jwt.ExpiredSignatureError:
            self.log_test("JWT Token Validation", False, "JWT token is expired")
        except jwt.InvalidTokenError as e:
            self.log_test("JWT Token Validation", False, 
                        f"JWT token is invalid: {str(e)}")
    
    def test_protected_endpoint(self):
        """Test accessing a protected endpoint with JWT token"""
        print("\n=== Testing Protected Endpoint Access ===")
        
        if not self.auth_token:
            self.log_test("Protected Endpoint Access", False, 
                        "No auth token available for testing")
            return
        
        headers = {'Authorization': f'Bearer {self.auth_token}'}
        
        try:
            response = self.session.get(f"{BASE_URL}/user/profile", headers=headers)
            
            if response.status_code == 200:
                data = response.json()
                if 'email' in data and data['email'] == 'newuser@test.com':
                    self.log_test("Protected Endpoint Access", True, 
                                "Successfully accessed protected endpoint with JWT token",
                                {"profile_data": data})
                else:
                    self.log_test("Protected Endpoint Access", False, 
                                "Protected endpoint returned unexpected data",
                                {"response": data})
            else:
                self.log_test("Protected Endpoint Access", False, 
                            f"Protected endpoint returned status {response.status_code}",
                            {"response": response.text})
                
        except requests.exceptions.RequestException as e:
            self.log_test("Protected Endpoint Access", False, 
                        f"Network error accessing protected endpoint: {str(e)}")
    
    def run_all_tests(self):
        """Run all authentication tests"""
        print(f"🚀 Starting SafeGuard Authentication API Tests")
        print(f"📍 Testing against: {BASE_URL}")
        print("=" * 60)
        
        # Run tests in sequence
        self.test_user_registration()
        time.sleep(1)  # Small delay between tests
        
        self.test_user_login()
        time.sleep(1)
        
        self.test_invalid_credentials()
        time.sleep(1)
        
        self.test_jwt_token_validation()
        time.sleep(1)
        
        self.test_protected_endpoint()
        
        # Summary
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for r in self.test_results if r['success'])
        total = len(self.test_results)
        
        print(f"Total Tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {total - passed}")
        print(f"Success Rate: {(passed/total)*100:.1f}%")
        
        if total - passed > 0:
            print("\n❌ FAILED TESTS:")
            for result in self.test_results:
                if not result['success']:
                    print(f"  • {result['test']}: {result['message']}")
        
        return passed == total

def main():
    """Main test execution"""
    tester = SafeGuardTester()
    success = tester.run_all_tests()
    
    if success:
        print("\n🎉 All authentication tests passed!")
        sys.exit(0)
    else:
        print("\n💥 Some tests failed!")
        sys.exit(1)

if __name__ == "__main__":
    main()