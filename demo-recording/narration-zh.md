# Learning Foundry 产品演示旁白

## 00:00–00:14｜产品体验入口

Learning Foundry 从学生正在发生的学习问题开始。这个本地演示把提问、能力路由、诊断、证据保存、延迟复习和组件改进连成一条可执行路径。

## 00:14–00:28｜有界诊断

学生把四点八克镁正确换算成零点二摩尔，却错误乘以零点五。系统检索 CAIE 9701 化学计量标准，路由到已发布的 Stoichiometric Product Mass 组件，并由 Standard Trainer 返回第一个错误：FORMULA，WRONG_STOICHIOMETRIC_RATIO。因为反应式中镁与氧化镁的系数是二比二，所以摩尔比是一比一，正确质量是八点零零克。

## 00:28–00:40｜Library

诊断不是一次性聊天内容。Library 同时保留可信标准、已发布组件、结构化诊断证据，以及学生可以重新查看的 worked correction。这里记录观察比值零点五和预期比值一。

## 00:40–00:52｜Schedule

Schedule 立即安排一次纠正路线回顾，并在三天后安排迁移练习。学生可以完成、重新打开，或者进入本地 Trainer。它不是完整日历，而是这条学习证据的下一步。

## 00:52–01:06｜可复用模式

为了演示 Conversation-to-Component，系统提供三个明确标注的 seeded evidence fixtures。它们不是生产 analytics，也不代表真实跨用户数据。共同的 FORMULA 阶段和错误码提示：应该加强已有组件的诊断提示和迁移题。

## 01:06–01:18｜进入 Foundry

教师点击 Promote 后，系统创建一点一零版本草稿，并带上来源 conversation ID 和 evidence ID。CONVERSATION_DERIVED 只存在于草稿元数据，不修改已发布 contract 的 provenance schema。

## 01:18–01:28｜治理边界

草稿进入 Governance Workbench 时，evaluation 是 NOT RUN，approval 保持锁定。学习证据可以提出改进，但不能跳过可靠性检查和专家责任。

## 01:28–01:40｜Foundry evaluation

现有 Foundry evaluator 运行十五项结构、引用、数值、教学和 runtime compatibility 检查。只有所有 blocking checks 通过，组件才能进入专家审核。

## 01:40–01:50｜专家审核

自动检查回答组件是否可以进入 runtime；专家审核仍然负责内容判断。通过检查后，Approve component 才会解锁。

## 01:50–02:00｜批准

专家批准后，审核人、时间和备注与这一版本绑定。任何后续内容编辑都会使 evaluation 和 approval 失效。

## 02:00–02:12｜发布

发布使用现有 publishApprovedComponent 权威，生成不可变快照和内容哈希。草稿成为 stoichiometric-product-mass 一点一零。

## 02:12–02:26｜返回 Library

回到 Product Experience，Library 现在显示从 learner evidence 产生、经过治理并正式发布的新版本。产品体验和治理层形成闭环。

## 02:26–02:38｜下游 runtime

最后打开另一个本地端口上的 Standard Trainer。它读取 Foundry 发布的 contract，本身不能编辑组件定义，也不调用 LLM。

## 02:38–02:52｜执行 contract

在 MASS 组件中输入摩尔比零点五和答案四克，Trainer 再次确定性地返回 FORMULA 与 WRONG_STOICHIOMETRIC_RATIO，并生成版本固定的 learner evidence trace。

## 02:52–03:04｜结尾

Product Experience 捕捉学习需求和证据。Foundry Governance 把可复用模式变成可靠组件。Standard Trainer 执行这些已发布的 contracts。这就是完整的 Learning Foundry 产品关系。
