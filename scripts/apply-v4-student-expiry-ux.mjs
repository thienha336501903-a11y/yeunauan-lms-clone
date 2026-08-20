import fs from 'node:fs';

const path = 'my-courses.html';
let text = fs.readFileSync(path, 'utf8');

const oldStateInfo = `function stateInfo(course){switch(course.state){case'ready':return{label:'🟢 Sẵn sàng vào học',cls:'st-ready',desc:'Khóa học đã được duyệt và nội dung đã sẵn sàng.'};case'approved_waiting_content':return{label:'🔵 Đã duyệt – Chờ lên bài',cls:'st-wait',desc:'Bạn đã được cấp quyền. Admin chưa chuyển nội dung khóa sang trạng thái Sẵn sàng.'};case'rejected':return{label:'🔴 Không được duyệt',cls:'st-rejected',desc:'Đơn đăng ký hiện không được duyệt. Vui lòng liên hệ hỗ trợ nếu cần kiểm tra.'};case'inactive':return{label:'⚪ Chưa hoạt động',cls:'st-inactive',desc:'Quyền học hiện chưa hoạt động.'};default:return{label:'🟠 Chờ duyệt',cls:'st-pending',desc:'Bill đã được ghi nhận và đang chờ Admin kiểm tra thanh toán.'}}}`;

const newStateInfo = `function stateInfo(course){const expiry=course.expiredAt?Date.parse(course.expiredAt):NaN;if(Number.isFinite(expiry)&&expiry<=Date.now()){const date=new Date(course.expiredAt).toLocaleDateString('vi-VN');return{label:'⏳ Đã hết hạn',cls:'st-inactive',desc:'Quyền học đã hết hạn ngày '+date+'. Liên hệ hỗ trợ nếu bạn cần gia hạn.'}}switch(course.state){case'ready':return{label:'🟢 Sẵn sàng vào học',cls:'st-ready',desc:'Khóa học đã được duyệt và nội dung đã sẵn sàng.'};case'approved_waiting_content':return{label:'🔵 Đã duyệt – Chờ lên bài',cls:'st-wait',desc:'Bạn đã được cấp quyền. Admin chưa chuyển nội dung khóa sang trạng thái Sẵn sàng.'};case'rejected':return{label:'🔴 Không được duyệt',cls:'st-rejected',desc:'Đơn đăng ký hiện không được duyệt. Vui lòng liên hệ hỗ trợ nếu cần kiểm tra.'};case'inactive':return{label:'⚪ Chưa hoạt động',cls:'st-inactive',desc:'Quyền học hiện chưa hoạt động.'};default:return{label:'🟠 Chờ duyệt',cls:'st-pending',desc:'Bill đã được ghi nhận và đang chờ Admin kiểm tra thanh toán.'}}}`;

if (!text.includes(oldStateInfo)) throw new Error('stateInfo anchor not found');
text = text.replace(oldStateInfo, newStateInfo);
fs.writeFileSync(path, text);
console.log('V4 student expiry UX patch applied.');
